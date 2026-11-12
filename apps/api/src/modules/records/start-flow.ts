import type { Db, Tx } from '@mono/db';
import {
  flowDefinitionSchema,
  makeRef,
  plainValues,
  refsOf,
  REFS_KEY,
  type FlowField,
  type RecordDefinition,
} from '@mono/shared';
import { AppError } from '../../lib/errors';
import { log, startRecordIn } from '../fms/engine';
import type { StatusHook } from './hooks';

const filled = (v: unknown) => !(v === undefined || v === null || v === '');

/** The published start form of a flow of this company (null when the flow is gone or not published). */
async function publishedStart(db: Db | Tx, companyId: string, flowId: string) {
  const flow = await db.flow.findFirst({
    where: { id: flowId, companyId, deletedAt: null },
    select: { id: true, name: true, code: true, status: true, currentVersionId: true },
  });
  if (!flow || flow.status !== 'PUBLISHED' || !flow.currentVersionId) return { flow, fields: null };
  const version = await db.flowVersion.findFirst({
    where: { id: flow.currentVersionId, companyId },
    select: { definition: true },
  });
  return { flow, fields: flowDefinitionSchema.parse(version?.definition ?? {}).startFields };
}

/** Published processes a move may start, with their start forms (for the type editor's mapping). */
export async function startableFlows(db: Db, companyId: string) {
  const flows = await db.flow.findMany({
    where: { companyId, deletedAt: null, status: 'PUBLISHED', currentVersionId: { not: null } },
    select: { id: true, code: true, name: true, currentVersionId: true },
    orderBy: { name: 'asc' },
  });
  const versions = await db.flowVersion.findMany({
    where: { companyId, id: { in: flows.map((f) => f.currentVersionId!) } },
    select: { id: true, definition: true },
  });
  const byId = new Map(versions.map((v) => [v.id, v.definition]));
  return flows.map((f) => ({
    id: f.id,
    code: f.code,
    name: f.name,
    startFields: flowDefinitionSchema
      .parse(byId.get(f.currentVersionId!) ?? {})
      .startFields.filter((x) => x.type !== 'formula')
      .map((x) => ({
        key: x.key,
        label: x.label,
        type: x.type,
        required: Boolean(x.required),
        master: x.master ?? null,
      })),
  }));
}

/** A value can be handed over only where it fits: photos, files, signatures and item lines stay with the record. */
const NOT_MAPPED = ['photo', 'file', 'signature', 'formula'];

/**
 * A type's "this move starts a process" settings must point at a published process of the company, name start
 * fields that exist, and fill every required one — checked when the type is saved, in words an admin can act on.
 */
export async function checkStartFlows(db: Db | Tx, companyId: string, def: RecordDefinition) {
  for (const m of def.moves) {
    if (!m.startFlow) continue;
    const { flow, fields } = await publishedStart(db, companyId, m.startFlow.flowId);
    const bad = (message: string) =>
      new AppError(400, 'VALIDATION_FAILED', `The move "${m.label}": ${message}`);
    if (!flow) throw bad('the process it starts does not exist any more — choose another');
    if (!fields)
      throw bad(`"${flow.name}" is not published yet — publish it first, or choose another process`);
    const byKey = new Map(fields.map((f) => [f.key, f]));
    for (const key of Object.keys(m.startFlow.map)) {
      const f = byKey.get(key);
      if (!f) throw bad(`"${flow.name}" has no start field "${key}" any more — set the values again`);
      if (NOT_MAPPED.includes(f.type))
        throw bad(`"${f.label}" of "${flow.name}" can't be filled from a record`);
    }
    for (const f of fields)
      if (f.required && !NOT_MAPPED.includes(f.type) && !m.startFlow.map[f.key])
        throw bad(`"${flow.name}" needs "${f.label}" to start — say where it comes from`);
  }
}

type RecordFacts = { id: string; code: string; title: string; data: Record<string, unknown> };

/** The start form of the process, filled from the record by the move's mapping (links travel with the values). */
export function startValues(map: Record<string, string>, fields: FlowField[], rec: RecordFacts) {
  const values = plainValues(rec.data);
  const links = refsOf(rec.data);
  const name = rec.title && rec.title !== rec.code ? `${rec.code} · ${rec.title}` : rec.code;
  const data: Record<string, unknown> = {};
  const refs: Record<string, string> = {};
  for (const f of fields) {
    const src = map[f.key];
    if (!src) continue;
    if (src === 'code') data[f.key] = rec.code;
    else if (src === 'title') data[f.key] = rec.title;
    else if (src === 'record') {
      data[f.key] = name;
      refs[f.key] = makeRef('rt', rec.id);
    } else if (src.startsWith('text:')) data[f.key] = src.slice(5);
    else if (src.startsWith('field:')) {
      const key = src.slice(6);
      if (!filled(values[key])) continue;
      data[f.key] = values[key];
      if (links[key]) refs[f.key] = links[key];
    }
  }
  return Object.keys(refs).length ? { ...data, [REFS_KEY]: refs } : data;
}

/**
 * "This move starts a process" (plan §2.6, row U7). Runs inside the move's transaction: the process record is
 * started through the same engine as the start form, so if that form refuses (a required value is empty on the
 * record), the move itself is refused with the reason and nothing is written.
 */
export const startFlowOnMove: StatusHook = async (tx, c) => {
  const start = c.move.startFlow;
  if (!start) return;
  const { flow, fields } = await publishedStart(tx, c.companyId, start.flowId);
  if (!flow || !fields)
    throw new AppError(
      409,
      'CONFLICT',
      `"${c.move.label}" starts ${flow ? `"${flow.name}", which is not published` : 'a process that does not exist any more'}: ask an admin to set the ${c.type.name.toLowerCase()} up again`,
    );
  let started;
  try {
    started = await startRecordIn(tx, {
      companyId: c.companyId,
      flowId: flow.id,
      data: startValues(start.map, fields, c.record),
      startedById: c.actorId,
      source: 'record',
    });
  } catch (e) {
    if (!(e instanceof AppError) || e.status >= 500) throw e;
    throw new AppError(e.status, e.code, `"${flow.name}" can't start: ${e.message}`, e.details);
  }
  await log(tx, started, 'note', {
    actorId: c.actorId,
    note: `Started from ${c.type.name} ${c.record.code}`,
    data: { recordType: c.type.id, record: c.record.id, code: c.record.code },
  });
  await tx.recordEvent.create({
    data: {
      companyId: c.companyId,
      recordId: c.record.id,
      type: 'flow_started',
      actorId: c.actorId,
      data: { flowId: flow.id, flow: flow.name, fmsRecordId: started.id, number: started.number },
    },
  });
};
