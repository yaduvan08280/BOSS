import { createId } from '@paralleldrive/cuid2';
import type { Db, Tx } from '@mono/db';
import {
  moveRecord,
  plainValues,
  recordRoles,
  recordTitleOf,
  TransitionError,
  type RecordDefinition,
} from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { releaseForm, type FormScope } from '../forms';
import { attachUploads, type Actor } from '../work/actor';
import { ctxOf, loadType, mustBeActive, type LoadedType } from './access';
import { checkRecord, commitRecord, fileIdsOf, refuseIfInvalid, type Lines, type RecordInput } from './form';
import { runStatusHooks } from './hooks';
import { fyNow, recordCode, takeNumbers } from './numbering';

export const formScope = (actor: Actor, t: LoadedType, recordId?: string): FormScope => ({
  companyId: actor.companyId,
  actorId: actor.userId,
  owner: { kind: 'recordType', id: t.id },
  recordId,
  canAddValues: t.access.admin,
});

/** A record of the actor's company with its type, after checking a right on that type. */
export async function loadRecord(
  db: Db | Tx,
  actor: Actor,
  id: string,
  right: Parameters<typeof loadType>[3] = 'view',
) {
  const rec = await db.recordEntry.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!rec) throw notFound('Record');
  const t = await loadType(db, actor, rec.typeId, right);
  return { rec, t };
}

const statusLabel = (def: RecordDefinition, key: string) =>
  def.statuses.find((s) => s.key === key)?.label ?? key;
const isFinal = (def: RecordDefinition, key: string) =>
  Boolean(def.statuses.find((s) => s.key === key)?.final);

/**
 * What every record event carries: for webhooks (the readable values), and for notification rules — `record`
 * ("SV/26-27/0004 · Sharma farm"), `creatorId` (the "creator" recipient) and `link` (opens the record).
 */
export const eventPayload = (
  t: LoadedType,
  rec: { id: string; code: string; title: string; status: string; createdById: string | null },
  data: unknown,
) => ({
  typeId: t.id,
  type: t.name,
  typeCode: t.code,
  recordId: rec.id,
  code: rec.code,
  title: rec.title,
  record: rec.title && rec.title !== rec.code ? `${rec.code} · ${rec.title}` : rec.code,
  status: rec.status,
  statusLabel: statusLabel(t.def, rec.status),
  creatorId: rec.createdById,
  link: `/records/${t.id}?record=${rec.id}`,
  data: plainValues(data),
});

/** A new record: checked like any form, numbered `{PREFIX}/{FY}/{0001}`, standing in the type's start status. */
export async function createRecord(db: Db, actor: Actor, typeId: string, input: RecordInput) {
  const t = await loadType(db, actor, typeId, 'create');
  mustBeActive(t);
  const id = createId();
  const scope = formScope(actor, t, id);
  const tables = Object.fromEntries(t.def.tables.map((x) => [x.key, input.lines?.[x.key] ?? []]));
  const checked = await checkRecord(db, scope, t.def, { data: input.data, lines: tables });
  refuseIfInvalid(checked);
  return db.$transaction(async (tx) => {
    const fy = await fyNow(tx, actor.companyId);
    const number = await takeNumbers(tx, actor.companyId, t.id, fy);
    const code = recordCode(t.prefix, fy, number);
    const stored = await commitRecord(tx, scope, t.def, checked);
    const rec = await tx.recordEntry.create({
      data: {
        id,
        companyId: actor.companyId,
        typeId: t.id,
        number,
        fy,
        code,
        title: recordTitleOf(t.def, stored.data, code),
        status: t.def.start,
        data: stored.data as object,
        lines: stored.lines as object,
        createdById: actor.userId,
      },
    });
    await attachUploads(
      tx,
      actor.companyId,
      actor.userId,
      fileIdsOf(t.def, stored.data, stored.lines),
      'record',
      id,
    );
    await tx.recordEvent.create({
      data: { companyId: actor.companyId, recordId: id, type: 'created', actorId: actor.userId },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'record.created',
      entityType: 'record',
      entityId: id,
      after: { code, status: rec.status, data: stored.data, lines: stored.lines },
      payload: { ...eventPayload(t, rec, stored.data), lines: stored.lines },
    });
    return { id, code, title: rec.title, status: rec.status };
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The labels of the fields and tables that differ between two saved states. */
function changedLabels(
  def: RecordDefinition,
  before: { data: unknown; lines: unknown },
  after: { data: Record<string, unknown>; lines: Lines },
) {
  const was = plainValues(before.data);
  const now = plainValues(after.data);
  const wasLines = (before.lines ?? {}) as Lines;
  return [
    ...def.fields.filter((f) => !same(was[f.key], now[f.key])).map((f) => f.label),
    ...def.tables.filter((t) => !same(wasLines[t.key] ?? [], after.lines[t.key] ?? [])).map((t) => t.label),
  ];
}

/**
 * Change a record's fields and child lines. `lines` left out keeps the tables as they are. A record in a final
 * status is closed: it can still take notes and files, but its fields no longer change.
 */
export async function updateRecord(db: Db, actor: Actor, id: string, input: RecordInput) {
  const { rec, t } = await loadRecord(db, actor, id, 'edit');
  if (isFinal(t.def, rec.status))
    throw new AppError(
      409,
      'CONFLICT',
      `This ${t.name.toLowerCase()} is ${statusLabel(t.def, rec.status)}: it can't be changed any more`,
    );
  const scope = formScope(actor, t, id);
  const checked = await checkRecord(db, scope, t.def, input);
  refuseIfInvalid(checked);
  return db.$transaction(async (tx) => {
    const stored = await commitRecord(tx, scope, t.def, checked, (rec.lines ?? {}) as Lines);
    const changed = changedLabels(t.def, rec, stored);
    if (!changed.length) return { id, code: rec.code, title: rec.title, changed };
    const title = recordTitleOf(t.def, stored.data, rec.code);
    await tx.recordEntry.update({
      where: { id },
      data: { data: stored.data as object, lines: stored.lines as object, title },
    });
    await attachUploads(
      tx,
      actor.companyId,
      actor.userId,
      fileIdsOf(t.def, stored.data, stored.lines),
      'record',
      id,
    );
    await tx.recordEvent.create({
      data: {
        companyId: actor.companyId,
        recordId: id,
        type: 'changed',
        actorId: actor.userId,
        data: { fields: changed },
      },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'record.changed',
      entityType: 'record',
      entityId: id,
      before: { data: rec.data, lines: rec.lines },
      after: { data: stored.data, lines: stored.lines },
      payload: { ...eventPayload(t, { ...rec, title }, stored.data), lines: stored.lines, changed },
    });
    return { id, code: rec.code, title, changed };
  });
}

/**
 * Make a move: the next status comes from the shared `transition()` over the type's own table of moves, which
 * also decides whether this person may make it. Nothing else ever writes `status`.
 */
export async function changeStatus(
  db: Db,
  actor: Actor,
  id: string,
  input: { action: string; note?: string | null },
) {
  const { rec, t } = await loadRecord(db, actor, id, 'view');
  const roles = recordRoles(t.access, rec.createdById === actor.userId);
  let res: ReturnType<typeof moveRecord>;
  try {
    res = moveRecord(t.def, { from: rec.status, action: input.action, roles }, t.name);
  } catch (e) {
    if (!(e instanceof TransitionError)) throw e;
    const from = statusLabel(t.def, rec.status);
    throw e.code === 'FORBIDDEN_TRANSITION'
      ? new AppError(403, 'FORBIDDEN_TRANSITION', `You can't make this move on ${t.pluralName.toLowerCase()}`)
      : new AppError(
          409,
          'INVALID_TRANSITION',
          isFinal(t.def, rec.status)
            ? `This ${t.name.toLowerCase()} is ${from}: nothing more can be done with it`
            : `That can't be done while the ${t.name.toLowerCase()} is ${from}`,
        );
  }
  const note = input.note?.trim() || null;
  if (res.move.noteRequired && !note)
    throw new AppError(400, 'VALIDATION_FAILED', `Write why, to ${res.move.label.toLowerCase()}`, {
      fields: { note: 'Write why' },
    });
  return db.$transaction(async (tx) => {
    // Guarded by the status it was read in: two people pressing at once can't both move it.
    const moved = await tx.recordEntry.updateMany({
      where: { id, status: rec.status, deletedAt: null },
      data: { status: res.to },
    });
    if (!moved.count)
      throw new AppError(409, 'CONFLICT', 'Someone else just changed this record: open it again');
    await tx.recordEvent.create({
      data: {
        companyId: actor.companyId,
        recordId: id,
        type: 'status',
        actorId: actor.userId,
        note,
        fromStatus: res.from,
        toStatus: res.to,
        data: {
          action: res.action,
          label: res.move.label,
          from: statusLabel(t.def, res.from),
          to: statusLabel(t.def, res.to),
        },
      },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'record.status_changed',
      entityType: 'record',
      entityId: id,
      before: { status: res.from },
      after: { status: res.to, action: res.action, note },
      payload: {
        ...eventPayload(t, { ...rec, status: res.to }, rec.data),
        from: res.from,
        fromLabel: statusLabel(t.def, res.from),
        action: res.action,
        move: res.move.label,
        note,
      },
    });
    await runStatusHooks(tx, {
      companyId: actor.companyId,
      actorId: actor.userId,
      type: t,
      record: { id, code: rec.code, title: rec.title, data: rec.data as Record<string, unknown> },
      from: res.from,
      to: res.to,
      move: res.move,
      note,
    });
    return { id, status: res.to, from: res.from };
  });
}

/**
 * Delete a record (kept as history, off every list; its number is never used again). Anyone who may edit can
 * delete one that is still open; a closed one (final status) only by the people who set the type up.
 */
export async function deleteRecord(db: Db, actor: Actor, id: string) {
  const { rec, t } = await loadRecord(db, actor, id, 'edit');
  if (isFinal(t.def, rec.status) && !t.access.admin)
    throw new AppError(
      403,
      'FORBIDDEN',
      `This ${t.name.toLowerCase()} is ${statusLabel(t.def, rec.status)}: only an admin can delete it`,
    );
  await db.$transaction(async (tx) => {
    await tx.recordEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    await releaseForm(tx, {
      companyId: actor.companyId,
      owner: { kind: 'recordType', id: t.id },
      recordId: id,
    });
    await tx.recordEvent.create({
      data: { companyId: actor.companyId, recordId: id, type: 'deleted', actorId: actor.userId },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'record.deleted',
      entityType: 'record',
      entityId: id,
      before: { code: rec.code, status: rec.status, data: rec.data, lines: rec.lines },
      payload: eventPayload(t, rec, rec.data),
    });
  });
  return { ok: true };
}
