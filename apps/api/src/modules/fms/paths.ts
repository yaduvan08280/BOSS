import type { Db } from '@mono/db';
import { flowFieldMap, mergeData, numeric, parsePath, showable, type FlowDefinition } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { sourceColumns } from '../masters/columns';
import { can, type Actor } from '../work/actor';
import { parseDefinition } from './engine';
import { pathReaders } from './show';

/** A value a process can show somewhere: its path, how to name it, and where it can be used. */
export type FlowPath = {
  path: string;
  label: string;
  /** "Start form" or the step's name. */
  group: string;
  /** The KPI source that reads it (`start:<path>` / `step:<key>:<path>`). */
  kpi: string;
  /** A number can be read from it: `true` for numbers, amounts, formulas and item lines; `null` = not known (a linked column). */
  numeric: boolean | null;
  /** It can stand in a column or a text (item lines can't; they count only as a total). */
  shown: boolean;
};

export const MAX_LIVE_COLUMNS = 6;

async function definitionOf(db: Db, companyId: string, flowId: string) {
  const flow = await db.flow.findFirst({
    where: { id: flowId, companyId, deletedAt: null },
    select: { id: true, name: true, draft: true, currentVersionId: true, liveColumns: true },
  });
  if (!flow) throw notFound('Process');
  const version = flow.currentVersionId
    ? await db.flowVersion.findUnique({ where: { id: flow.currentVersionId }, select: { definition: true } })
    : null;
  return { flow, def: parseDefinition(version?.definition ?? flow.draft) };
}

/**
 * Every path a process offers (plan §2.5): each field, and for a field that links to a row, that row's columns
 * (`customer.city`). The published version is read (the draft until there is one).
 */
export async function flowPaths(db: Db, actor: Actor, flowId: string): Promise<FlowPath[]> {
  const { def } = await definitionOf(db, actor.companyId, flowId);
  return pathsOf(db, actor, def);
}

async function pathsOf(db: Db, actor: Actor, def: FlowDefinition): Promise<FlowPath[]> {
  const out: FlowPath[] = [];
  const seen = new Set<string>();
  const columnsOf = new Map<string, Promise<{ key: string; label: string }[]>>();
  const forms = [
    { group: 'Start form', kpi: 'start', fields: def.startFields },
    ...def.steps.map((s) => ({ group: s.name, kpi: `step:${s.key}`, fields: s.fields })),
  ];
  for (const form of forms)
    for (const f of form.fields) {
      // A key used again on a later step reads the first one (`flowFieldMap`): offered once.
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      if (showable(f) || f.type === 'items')
        out.push({
          path: f.key,
          label: f.label,
          group: form.group,
          kpi: `${form.kpi}:${f.key}`,
          numeric: numeric(f) || f.type === 'items',
          shown: showable(f),
        });
      if (f.type !== 'master') continue;
      const source = f.master ?? 'customers';
      // A source this person may not read (another process, a record type) simply offers no columns.
      if (!columnsOf.has(source))
        columnsOf.set(
          source,
          sourceColumns(db, actor, source).catch(() => []),
        );
      for (const c of await columnsOf.get(source)!)
        out.push({
          path: `${f.key}.${c.key}`,
          label: `${f.label} → ${c.label}`,
          group: form.group,
          kpi: `${form.kpi}:${f.key}.${c.key}`,
          numeric: null,
          shown: true,
        });
    }
  return out;
}

/** The extra columns of a process's Live FMS list (view setting; needs the right to build processes). */
export async function setLiveColumns(db: Db, actor: Actor, flowId: string, columns: string[]) {
  if (!can(actor, 'fms.edit')) throw new AppError(403, 'FORBIDDEN', "You can't change this list's columns");
  const { flow, def } = await definitionOf(db, actor.companyId, flowId);
  const paths = [...new Set(columns)];
  if (paths.length > MAX_LIVE_COLUMNS)
    throw new AppError(400, 'VALIDATION_FAILED', `Choose at most ${MAX_LIVE_COLUMNS} columns`);
  const offered = new Map((await pathsOf(db, actor, def)).filter((p) => p.shown).map((p) => [p.path, p]));
  for (const p of paths)
    if (!parsePath(p) || !offered.has(p))
      throw new AppError(400, 'VALIDATION_FAILED', `"${p}" is not a value of this process`);
  await db.$transaction(async (tx) => {
    await tx.flow.update({ where: { id: flow.id }, data: { liveColumns: paths } });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'fms.live_columns',
        entityType: 'flow',
        entityId: flow.id,
        before: { liveColumns: flow.liveColumns },
        after: { liveColumns: paths },
      },
    );
  });
  return { columns: paths };
}

/**
 * The chosen columns' values for a page of records: each record's start form and finished steps as one, read
 * through the links in one go (no query per record). Labels come with them.
 */
export async function liveColumnValues(
  db: Db,
  actor: Actor,
  flow: { id: string; liveColumns: string[] },
  def: FlowDefinition,
  tz: string,
  records: { id: string; data: unknown }[],
) {
  const paths = flow.liveColumns.filter((p) => parsePath(p));
  if (!paths.length) return { columns: [], values: new Map<string, Record<string, string>>() };
  const fields = flowFieldMap(def);
  const done = records.length
    ? await db.fmsRecordStep.findMany({
        where: { companyId: actor.companyId, recordId: { in: records.map((r) => r.id) }, status: 'DONE' },
        orderBy: { doneAt: 'asc' },
        select: { recordId: true, data: true },
      })
    : [];
  const steps = new Map<string, unknown[]>();
  for (const s of done) steps.set(s.recordId, [...(steps.get(s.recordId) ?? []), s.data]);
  const datas = records.map((r) => mergeData(r.data, ...(steps.get(r.id) ?? [])));
  const readers = await pathReaders(db, actor.companyId, tz, fields, datas, paths);
  const labels = new Map((await pathsOf(db, actor, def)).map((p) => [p.path, p.label]));
  return {
    columns: paths.map((p) => ({ path: p, label: labels.get(p) ?? p })),
    values: new Map(
      records.map((r, i) => [
        r.id,
        Object.fromEntries(
          paths.flatMap((p) => {
            const text = readers[i]!.text(p);
            return text === null ? [] : [[p, text]];
          }),
        ),
      ]),
    ),
  };
}
