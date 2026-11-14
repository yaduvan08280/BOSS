import type { Db, Prisma as P } from '@mono/db';
import {
  ASK_VIEWS,
  askPlanSchema,
  askViewsFor,
  checkAskPlan,
  evalFormula,
  type AskPlan,
  type AskView,
  type AskViewKey,
} from '@mono/shared';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { planSql, runReadOnly } from './ask';
import { runAi } from './llm';
import * as CHAT from './prompts/chat.v1';
import { companyContext } from './prompts/context';

/**
 * The AI chat (14/11/2026): a conversation that answers from the whole of MONO's data, in English, Hindi or
 * Hinglish. Each model turn is one step — look something up in a read-only view, work out a sum with MONO's
 * calculator, or answer — so the model never touches the database (decision 60). The owner reads every view;
 * anyone else only the views their rights allow, their own rows of personal data, and their branches' rows.
 */
const lookupSchema = askPlanSchema.pick({
  view: true,
  columns: true,
  filters: true,
  groupBy: true,
  aggregate: true,
  orderBy: true,
  limit: true,
});
export const chatStepSchema = z.object({
  action: z.enum(['lookup', 'calculate', 'answer']),
  purpose: z.string().describe("One short line, in the person's language, of what this step does"),
  lookup: lookupSchema.nullable().describe('For action "lookup"'),
  calculate: z
    .object({ expression: z.string(), label: z.string() })
    .nullable()
    .describe('For action "calculate"'),
  answer: z.string().nullable().describe('For action "answer": the reply'),
  showLookup: z.number().nullable().describe('For "answer": which lookup (1 = first) to show as a table'),
  suggestions: z.array(z.string()).describe('For "answer": up to 3 follow-up questions'),
});
export type ChatStep = z.infer<typeof chatStepSchema>;

const MAX_STEPS = 8;
const HISTORY_TURNS = 10;
const ROWS_TO_MODEL = 80;
const ROWS_TO_SCREEN = 200;

type Table = {
  view: string;
  label: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
};
export type ChatData = {
  steps: { purpose: string; kind: 'lookup' | 'calculate'; view?: string; rows?: number; result?: string }[];
  table: Table | null;
  suggestions: string[];
};

const plain = (v: unknown) => (typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : v);
const isOwner = (actor: Actor) => actor.permissions.includes('*');

/** What this person may read, and whether their personal views are narrowed to their own rows. */
export function chatScope(actor: Actor) {
  const owner = isOwner(actor);
  return {
    owner,
    views: owner ? (Object.keys(ASK_VIEWS) as AskViewKey[]) : askViewsFor(actor.permissions),
    onlyPersonId: owner ? null : actor.userId,
  };
}

async function runLookup(db: Db, actor: Actor, tz: string, plan: z.infer<typeof lookupSchema>) {
  const scope = chatScope(actor);
  if (!scope.views.includes(plan.view)) return { error: `You may not read "${plan.view}".` };
  const full: AskPlan = { ...plan, answerable: true, why: '', report: null };
  const problems = checkAskPlan(full);
  if (problems.length) return { error: problems.join('; ') };
  try {
    const { columns, sql } = planSql(full, actor.companyId, tz, scope.onlyPersonId);
    const rows = (await runReadOnly(db, sql)).map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])),
    );
    return { columns, rows };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 200) : 'The lookup failed' };
  }
}

export async function listChats(db: Db, actor: Actor) {
  return db.aiChat.findMany({
    where: { companyId: actor.companyId, userId: actor.userId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
}

async function myChat(db: Db, actor: Actor, id: string) {
  const chat = await db.aiChat.findFirst({
    where: { id, companyId: actor.companyId, userId: actor.userId, deletedAt: null },
  });
  if (!chat) throw notFound('Chat');
  return chat;
}

export async function getChat(db: Db, actor: Actor, id: string) {
  const chat = await myChat(db, actor, id);
  const messages = await db.aiChatMessage.findMany({
    where: { chatId: chat.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, data: true, createdAt: true },
  });
  return { id: chat.id, title: chat.title, messages };
}

export async function deleteChat(db: Db, actor: Actor, id: string) {
  const chat = await myChat(db, actor, id);
  await db.aiChat.update({ where: { id: chat.id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

/** One question in a chat (a new chat when `chatId` is null): runs the steps and keeps both turns. */
export async function sendMessage(
  db: Db,
  actor: Actor,
  appSecret: string,
  input: { chatId?: string | null; text: string },
) {
  if (!can(actor, 'ai.view')) throw new AppError(403, 'FORBIDDEN', "You can't use the AI chat");
  const text = input.text.trim();
  if (!text) throw new AppError(400, 'VALIDATION_FAILED', 'Type a question');
  const chat = input.chatId
    ? await myChat(db, actor, input.chatId)
    : await db.aiChat.create({
        data: { companyId: actor.companyId, userId: actor.userId, title: text.slice(0, 80) },
      });
  const history = (
    await db.aiChatMessage.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS * 2,
      select: { role: true, content: true },
    })
  ).reverse();
  await db.aiChatMessage.create({
    data: { companyId: actor.companyId, chatId: chat.id, role: 'user', content: text },
  });

  const ctx = await companyContext(db, actor.companyId);
  const me = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true } });
  const scope = chatScope(actor);
  const system = CHAT.system(ctx, scope.views, { name: me.name, owner: scope.owner });
  const caller = { companyId: actor.companyId, userId: actor.userId, appSecret };
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: text },
  ];
  const data: ChatData = { steps: [], table: null, suggestions: [] };
  // Every lookup keeps its number (a refused one as null), so "show lookup 2" is always the second.
  const tables: (Table | null)[] = [];
  let answer: string | null = null;
  let last: ChatStep | null = null;

  for (let i = 0; i < MAX_STEPS && answer === null; i++) {
    const finalTurn = i === MAX_STEPS - 1;
    const { data: step } = await runAi(db, caller, 'chat', CHAT.id, (llm) =>
      llm.json({
        system,
        messages: finalTurn
          ? [...messages, { role: 'user', content: 'Answer now with what you have found (action "answer").' }]
          : messages,
        schema: chatStepSchema,
        effort: 'low',
        maxTokens: 4_000,
      }),
    );
    last = step;
    messages.push({ role: 'assistant', content: JSON.stringify(step) });
    if (step.action === 'answer' || finalTurn) {
      answer = step.answer?.trim() || "I couldn't put an answer together — try asking it another way.";
      break;
    }
    if (step.action === 'lookup' && step.lookup) {
      const r = await runLookup(db, actor, ctx.timezone, step.lookup);
      if ('error' in r) {
        data.steps.push({ purpose: step.purpose, kind: 'lookup', view: step.lookup.view, rows: 0 });
        tables.push(null);
        messages.push({ role: 'user', content: `Lookup ${tables.length} could not run: ${r.error}` });
        continue;
      }
      const view = ASK_VIEWS[step.lookup.view] as AskView;
      tables.push({
        view: step.lookup.view,
        label: view.label,
        columns: r.columns,
        rows: r.rows.slice(0, ROWS_TO_SCREEN),
        total: r.rows.length,
      });
      data.steps.push({ purpose: step.purpose, kind: 'lookup', view: step.lookup.view, rows: r.rows.length });
      const shown = r.rows.slice(0, ROWS_TO_MODEL).map(({ link: _, ...x }) => x);
      messages.push({
        role: 'user',
        content: `Lookup ${tables.length} (${step.lookup.view}): ${r.rows.length} row(s)${
          r.rows.length > ROWS_TO_MODEL ? `, first ${ROWS_TO_MODEL} shown` : ''
        }\n${JSON.stringify(shown)}`,
      });
      continue;
    }
    if (step.action === 'calculate' && step.calculate) {
      const value = evalFormula(step.calculate.expression, {});
      const result =
        value === null || value === undefined ? 'no value (check the expression)' : String(value);
      data.steps.push({
        purpose: step.purpose,
        kind: 'calculate',
        result: `${step.calculate.label} = ${result}`,
      });
      messages.push({
        role: 'user',
        content: `Calculation "${step.calculate.label}": ${step.calculate.expression} = ${result}`,
      });
      continue;
    }
    messages.push({ role: 'user', content: 'That step was empty: fill "lookup", "calculate" or "answer".' });
  }

  const pick = last?.showLookup ? (tables[last.showLookup - 1] ?? null) : null;
  data.table = pick ?? null;
  data.suggestions = (last?.suggestions ?? []).slice(0, 3);
  const saved = await db.aiChatMessage.create({
    data: {
      companyId: actor.companyId,
      chatId: chat.id,
      role: 'assistant',
      content: answer ?? '',
      data: data as unknown as P.InputJsonValue,
    },
    select: { id: true, role: true, content: true, data: true, createdAt: true },
  });
  await db.aiChat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
  return { chatId: chat.id, title: chat.title, message: saved };
}
