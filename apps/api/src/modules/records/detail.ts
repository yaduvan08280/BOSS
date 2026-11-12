import type { Db } from '@mono/db';
import { movesFor, recordRoles } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { attachUploads, type Actor } from '../work/actor';
import { ctxOf } from './access';
import { fileIdsOf, type Lines } from './form';
import { eventPayload, loadRecord } from './records';
import { typeView } from './types';

const fileOf = (f: { id: string; originalName: string; mime: string; size: number; createdAt: Date }) => ({
  id: f.id,
  url: `/api/files/${f.id}`,
  name: f.originalName,
  mime: f.mime,
  size: f.size,
  createdAt: f.createdAt,
});

/** A record for its drawer: values, lines, the moves this person may make, notes and history, files. */
export async function recordDetail(db: Db, actor: Actor, id: string) {
  const { rec, t } = await loadRecord(db, actor, id, 'view');
  const [events, files] = await Promise.all([
    db.recordEvent.findMany({ where: { recordId: id }, orderBy: { createdAt: 'asc' }, take: 500 }),
    db.attachment.findMany({
      where: { companyId: actor.companyId, entityType: 'record', entityId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const ids = [...new Set([rec.createdById, ...events.map((e) => e.actorId)].filter(Boolean))] as string[];
  const people = new Map(
    (
      await db.user.findMany({
        where: { companyId: actor.companyId, id: { in: ids } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const status = t.def.statuses.find((s) => s.key === rec.status);
  const closed = Boolean(status?.final);
  const inFields = new Set(fileIdsOf(t.def, rec.data as Record<string, unknown>, (rec.lines ?? {}) as Lines));
  return {
    type: typeView(t),
    record: {
      id: rec.id,
      code: rec.code,
      title: rec.title,
      status: rec.status,
      data: rec.data,
      lines: rec.lines,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      createdById: rec.createdById,
      createdBy: rec.createdById ? (people.get(rec.createdById) ?? null) : null,
    },
    moves: movesFor(t.def, rec.status, recordRoles(t.access, rec.createdById === actor.userId)).map((m) => ({
      action: m.action,
      label: m.label,
      to: m.to,
      noteRequired: Boolean(m.noteRequired),
    })),
    can: {
      edit: t.access.edit && !closed,
      files: t.access.edit,
      delete: t.access.edit && (!closed || t.access.admin),
    },
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      at: e.createdAt,
      by: e.actorId ? (people.get(e.actorId) ?? null) : null,
      note: e.note,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      data: e.data,
    })),
    files: files.map((f) => ({ ...fileOf(f), inField: inFields.has(f.id) })),
  };
}

/** Anyone who can see a record can write a note on it (like tasks, decision 57). */
export async function addNote(db: Db, actor: Actor, id: string, text: string) {
  const { rec, t } = await loadRecord(db, actor, id, 'view');
  const note = text.trim();
  if (!note) throw new AppError(400, 'VALIDATION_FAILED', 'Write the note first');
  return db.$transaction(async (tx) => {
    const e = await tx.recordEvent.create({
      data: { companyId: actor.companyId, recordId: id, type: 'note', actorId: actor.userId, note },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'record.note',
      entityType: 'record',
      entityId: id,
      after: { note },
      payload: { ...eventPayload(t, rec, rec.data), note },
    });
    return { id: e.id };
  });
}

/** Attach uploaded files to a record (needs the right to edit this type's records). */
export async function addFiles(db: Db, actor: Actor, id: string, ids: string[]) {
  const { rec, t } = await loadRecord(db, actor, id, 'edit');
  return db.$transaction(async (tx) => {
    const mine = await tx.attachment.findMany({
      where: {
        id: { in: ids },
        companyId: actor.companyId,
        uploadedById: actor.userId,
        entityType: 'upload',
        deletedAt: null,
      },
      select: { id: true, originalName: true },
    });
    if (!mine.length) throw new AppError(400, 'VALIDATION_FAILED', 'Upload the file first');
    await attachUploads(
      tx,
      actor.companyId,
      actor.userId,
      mine.map((f) => f.id),
      'record',
      id,
    );
    const names = mine.map((f) => f.originalName);
    await tx.recordEvent.create({
      data: {
        companyId: actor.companyId,
        recordId: id,
        type: 'file',
        actorId: actor.userId,
        data: { files: names },
      },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'record.changed',
      entityType: 'record',
      entityId: id,
      after: { filesAdded: names },
      payload: {
        typeId: t.id,
        type: t.name,
        recordId: id,
        code: rec.code,
        title: rec.title,
        status: rec.status,
        changed: ['Files'],
        filesAdded: names,
      },
    });
    return { added: mine.length };
  });
}

/** Take a file off a record (kept on the server as history). A file held by a field is changed in the field. */
export async function removeFile(db: Db, actor: Actor, id: string, fileId: string) {
  const { rec, t } = await loadRecord(db, actor, id, 'edit');
  const file = await db.attachment.findFirst({
    where: { id: fileId, companyId: actor.companyId, entityType: 'record', entityId: id, deletedAt: null },
  });
  if (!file) throw notFound('File');
  if (fileIdsOf(t.def, rec.data as Record<string, unknown>, (rec.lines ?? {}) as Lines).includes(fileId))
    throw new AppError(409, 'CONFLICT', 'This file belongs to a field: change it in the form instead');
  await db.$transaction(async (tx) => {
    await tx.attachment.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
    await tx.recordEvent.create({
      data: {
        companyId: actor.companyId,
        recordId: id,
        type: 'file_removed',
        actorId: actor.userId,
        data: { files: [file.originalName] },
      },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'record.changed',
      entityType: 'record',
      entityId: id,
      before: { file: file.originalName },
      payload: {
        typeId: t.id,
        type: t.name,
        recordId: id,
        code: rec.code,
        title: rec.title,
        status: rec.status,
        changed: ['Files'],
        fileRemoved: file.originalName,
      },
    });
  });
  return { ok: true };
}

/**
 * The files route asks here before sending a file that belongs to a record: the person must be able to see
 * that record's type. (A deleted record's files are closed.)
 */
export async function assertRecordFile(db: Db, actor: Actor, recordId: string) {
  await loadRecord(db, actor, recordId, 'view');
}
