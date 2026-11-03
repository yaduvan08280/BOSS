import type { Db } from '@mono/db';
import {
  aiFlowDraftSchema,
  aiKpiSchema,
  aiMasterSchema,
  draftToFlow,
  flowDefinitionSchema,
  flowDiff,
  flowMetaSchema,
  flowToDraft,
  toFields,
  type AiFlowDraft,
  type FlowDefinition,
  type FlowStep,
} from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { can, type Actor } from '../work/actor';
import { createFlow } from '../fms/builder';
import { runAi } from './llm';
import type { Llm, LlmUsage } from './providers';
import * as BUILD from './prompts/build-flow.v1';
import { companyContext, type CompanyContext } from './prompts/context';
import * as EDIT from './prompts/edit-flow.v1';
import * as KPIS from './prompts/kpis.v1';
import * as MASTER from './prompts/master.v1';

const needFms = (actor: Actor) => {
  if (!can(actor, 'fms.edit')) throw new AppError(403, 'FORBIDDEN', "You can't build processes");
};
const caller = (actor: Actor, appSecret: string) => ({
  companyId: actor.companyId,
  userId: actor.userId,
  appSecret,
});

/** Problems the model can fix if told (a person fixes the rest in the builder: unknown names, etc.). */
const REPAIRABLE = new Set([
  'noTime',
  'unknownTarget',
  'orphan',
  'noEnd',
  'decisionBranches',
  'duplicateKey',
]);

function describe(out: ReturnType<typeof draftToFlow>): string[] {
  const name = (k?: string) => out.definition.steps.find((s) => s.key === k)?.name ?? k ?? '';
  return out.issues.flatMap((i) => {
    switch (i.code) {
      case 'noTime':
        return [`Step "${name(i.stepKey)}" has no time; give it a realistic one.`];
      case 'unknownTarget':
        return [
          `Step "${name(i.stepKey)}" leads to "${i.detail}", which is not a step key (use a key or "end").`,
        ];
      case 'orphan':
        return [`Step "${name(i.stepKey)}" can never be reached; route a step to it or remove it.`];
      case 'noEnd':
        return ['No path reaches "end"; the last step must lead to "end".'];
      case 'decisionBranches':
        return [`Decision "${name(i.stepKey)}" needs both "yes" and "no".`];
      case 'duplicateKey':
        return [`Two steps share the key "${i.stepKey}".`];
      default:
        return [];
    }
  });
}

/**
 * Draft, check, and — when the draft has problems MONO can name — ask the model once to fix them,
 * keeping whichever version has fewer problems. Used by Build and Edit with AI, and by the evals.
 */
export async function draftWithRepair(llm: Llm, ctx: CompanyContext, system: string, user: string) {
  const ask = (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    llm.json({ system, messages, schema: aiFlowDraftSchema, effort: 'medium', maxTokens: 32_000 });
  const count = (o: ReturnType<typeof draftToFlow>) => o.issues.filter((i) => REPAIRABLE.has(i.code)).length;
  const first = await ask([{ role: 'user', content: user }]);
  let best = { data: first.data, out: draftToFlow(first.data, ctx) };
  let usage: LlmUsage = first.usage;
  let repaired = false;
  if (count(best.out)) {
    const fix = await ask([
      { role: 'user', content: user },
      { role: 'assistant', content: JSON.stringify(first.data) },
      { role: 'user', content: BUILD.repair(describe(best.out)) },
    ]).catch(() => null);
    if (fix) {
      usage = {
        inputTokens: usage.inputTokens + fix.usage.inputTokens,
        outputTokens: usage.outputTokens + fix.usage.outputTokens,
      };
      const out = draftToFlow(fix.data, ctx);
      if (count(out) < count(best.out)) best = { data: fix.data, out };
      repaired = true;
    }
  }
  return { data: best.data, out: best.out, usage, repaired };
}

export type DraftInput = {
  text: string;
  name?: string | null;
  departmentId?: string | null;
  previous?: AiFlowDraft | null;
  changes?: string | null;
};

/** "Build with AI": the description → a checked draft, people matched to real users, unknown names flagged. */
export async function draftFlow(db: Db, actor: Actor, appSecret: string, input: DraftInput) {
  needFms(actor);
  const ctx = await companyContext(db, actor.companyId);
  const department = input.departmentId
    ? ctx.departments.find((d) => d.id === input.departmentId)?.name
    : null;
  const r = await runAi(db, caller(actor, appSecret), 'build_flow', BUILD.id, (llm) =>
    draftWithRepair(llm, ctx, BUILD.system(ctx), BUILD.user({ ...input, department })),
  );
  return { draft: r.data, ...r.out, remember: r.data.remember.slice(0, 5) };
}

/** "Open in the Builder": the draft becomes a real (draft) process. The server converts it again itself. */
export async function createFromDraft(db: Db, actor: Actor, draft: AiFlowDraft, text: string) {
  needFms(actor);
  const ctx = await companyContext(db, actor.companyId);
  const out = draftToFlow(draft, ctx);
  const flow = await createFlow(
    db,
    actor,
    flowMetaSchema.parse({ ...out.meta, description: text.slice(0, 4000) }),
    out.definition,
  );
  return { id: flow.id, code: flow.code };
}

/** What the AI's shape can't carry (backups, date-field timing, documents, field help) stays as it was. */
function keepDetails(before: FlowDefinition, after: FlowDefinition): FlowDefinition {
  const old = new Map(before.steps.map((s) => [s.key, s]));
  const steps = after.steps.map((s): FlowStep => {
    const o = old.get(s.key);
    if (!o) return s;
    const fields = s.fields.map((f) => {
      const of = o.fields.find((x) => x.label === f.label);
      return of ? { ...f, key: of.key, help: of.help, master: of.master } : f;
    });
    return {
      ...s,
      backupIds: o.backupIds,
      documents: o.documents,
      fields,
      time:
        s.time ?? (o.time && (o.time.anchor === 'dateField' || o.time.anchor === 'fixed') ? o.time : s.time),
      auto: s.auto && o.auto ? { ...o.auto, ...s.auto } : s.auto,
    };
  });
  const startFields = after.startFields.map((f) => {
    const of = before.startFields.find((x) => x.label === f.label);
    return of ? { ...f, key: of.key, help: of.help, master: of.master } : f;
  });
  return { ...after, startFields, steps, timeModel: before.timeModel };
}

/** "Edit with AI": the whole flow comes back changed; the person sees what changed and accepts or not. */
export async function editFlowWithAi(
  db: Db,
  actor: Actor,
  appSecret: string,
  flowId: string,
  instruction: string,
) {
  needFms(actor);
  const flow = await db.flow.findFirst({
    where: { id: flowId, companyId: actor.companyId, deletedAt: null },
  });
  if (!flow) throw notFound('Process');
  const ctx = await companyContext(db, actor.companyId);
  const before = flowDefinitionSchema.parse(flow.draft);
  const names = new Map(ctx.people.map((p) => [p.id, p.name]));
  const current = flowToDraft(
    before,
    {
      name: flow.name,
      runName: flow.runName,
      coordinatorId: flow.coordinatorId,
      solverId: flow.solverId,
      departments: ctx.departments.filter((d) => flow.departmentIds.includes(d.id)).map((d) => d.name),
    },
    names,
  );
  const r = await runAi(db, caller(actor, appSecret), 'edit_flow', EDIT.id, (llm) =>
    draftWithRepair(llm, ctx, EDIT.system(ctx), EDIT.user(current, instruction)),
  );
  const out = r.out;
  const definition = keepDetails(before, out.definition);
  return { definition, diff: flowDiff(before, definition), unmatched: out.unmatched, issues: out.issues };
}

const NUMERIC = new Set(['number', 'amount']);

/** "Suggest with AI" for the Dashboard tab: only cards whose field exists and can be added up. */
export async function suggestKpis(db: Db, actor: Actor, appSecret: string, flowId: string) {
  needFms(actor);
  const flow = await db.flow.findFirst({
    where: { id: flowId, companyId: actor.companyId, deletedAt: null },
  });
  if (!flow) throw notFound('Process');
  const definition = flowDefinitionSchema.parse(flow.draft);
  const ctx = await companyContext(db, actor.companyId);
  const r = await runAi(db, caller(actor, appSecret), 'kpis', KPIS.id, (llm) =>
    llm.json({
      system: KPIS.system(ctx),
      messages: [
        { role: 'user', content: KPIS.user({ name: flow.name, runName: flow.runName, definition }) },
      ],
      schema: aiKpiSchema,
      effort: 'low',
      maxTokens: 8_000,
    }),
  );
  const typeOf = (source: string) => {
    if (source === 'count') return 'count';
    const [kind, a, b] = source.split(':');
    if (kind === 'start') return definition.startFields.find((f) => f.key === a)?.type;
    if (kind === 'step')
      return definition.steps.find((s) => s.key === a)?.fields.find((f) => f.key === b)?.type;
    return undefined;
  };
  return r.data.cards.flatMap((c) => {
    const t = typeOf(c.source);
    if (!t) return [];
    const aggregation = t === 'count' || !NUMERIC.has(t) ? 'COUNT' : c.aggregation;
    return [{ label: c.label.slice(0, 60), source: c.source, aggregation, period: c.period, why: c.why }];
  });
}

/** "Build a master with AI": a proposed list of fields to edit before saving. */
export async function draftMaster(db: Db, actor: Actor, appSecret: string, text: string) {
  const ctx = await companyContext(db, actor.companyId);
  const r = await runAi(db, caller(actor, appSecret), 'master', MASTER.id, (llm) =>
    llm.json({
      system: MASTER.system(ctx),
      messages: [{ role: 'user', content: MASTER.user(text) }],
      schema: aiMasterSchema,
      effort: 'low',
      maxTokens: 8_000,
    }),
  );
  const fields = toFields(r.data.fields);
  const keyOf = (label: string | null) => fields.find((f) => f.label === label)?.key ?? null;
  return {
    name: r.data.name.slice(0, 80),
    description: r.data.description.slice(0, 300),
    fields,
    keyField: keyOf(r.data.keyField),
    displayField: keyOf(r.data.displayField) ?? fields[0]?.key ?? null,
  };
}

/** Append "Remember this for next time?" lines the person ticked to the business details. */
export async function rememberFacts(db: Db, actor: Actor, lines: string[]) {
  const add = lines.map((l) => l.trim()).filter(Boolean);
  if (!add.length) return { added: 0 };
  return db.$transaction(async (tx) => {
    const row = await tx.businessDetails.findUnique({ where: { companyId: actor.companyId } });
    const text = [row?.text.trim(), ...add.map((l) => `- ${l}`)].filter(Boolean).join('\n');
    await tx.businessDetails.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, text, updatedById: actor.userId },
      update: { text, updatedById: actor.userId },
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'ai.remembered', entityType: 'business_details', entityId: actor.companyId, after: { add } },
    );
    return { added: add.length };
  });
}
