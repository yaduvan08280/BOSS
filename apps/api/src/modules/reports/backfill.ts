import type { Db, Tx } from '@mono/db';
import {
  flowDefinitionSchema,
  flowFieldMap,
  mergeData,
  plainValues,
  recordDefinitionSchema,
  refsOf,
  type FlowField,
} from '@mono/shared';
import type { FormOwner } from '../forms';
import { reportCopy, writeCopies } from '../forms/report';

type Owner = { kind: 'flow' | 'recordType'; id: string };

const liveRecords = (db: Db | Tx, owner: Owner) =>
  owner.kind === 'flow'
    ? db.fmsRecord.count({ where: { flowId: owner.id, deletedAt: null, status: { not: 'CANCELLED' } } })
    : db.recordEntry.count({ where: { typeId: owner.id, deletedAt: null } });

/**
 * Called when a form's definition is saved (a process is published, a record type is saved): a field newly
 * marked "reportable" is queued for the worker to copy the values of the records that already exist; a field
 * no longer marked loses its copies. With no records yet there is nothing to copy and the field is ready at once.
 */
export async function syncReportable(tx: Tx, companyId: string, owner: Owner, fields: FlowField[]) {
  const marked = new Set(fields.filter((f) => f.reportable).map((f) => f.key));
  const have = await tx.reportBackfill.findMany({ where: { ownerKind: owner.kind, ownerId: owner.id } });
  const known = new Set(have.map((b) => b.field));
  const fresh = [...marked].filter((k) => !known.has(k));
  if (fresh.length) {
    const total = await liveRecords(tx, owner);
    await tx.reportBackfill.createMany({
      data: fresh.map((field) => ({
        companyId,
        ownerKind: owner.kind,
        ownerId: owner.id,
        field,
        total,
        status: total ? 'PENDING' : 'DONE',
      })),
    });
  }
  const gone = have.filter((b) => !marked.has(b.field)).map((b) => b.field);
  if (gone.length) {
    await tx.reportBackfill.deleteMany({
      where: { ownerKind: owner.kind, ownerId: owner.id, field: { in: gone } },
    });
    await tx.reportValue.deleteMany({
      where: { ownerKind: owner.kind, ownerId: owner.id, field: { in: gone } },
    });
  }
  return { queued: fresh.length, removed: gone.length };
}

/** How far each reportable field of a form is (the editor shows "Copying 1,240 of 8,000"). */
export async function backfillState(db: Db, companyId: string, owner: FormOwner) {
  const rows = await db.reportBackfill.findMany({
    where: { companyId, ownerKind: owner.kind, ownerId: owner.id },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((b) => ({ field: b.field, status: b.status, copied: b.copied, total: b.total }));
}

/** The field as the owner's current definition has it (null when it is gone or no longer reportable). */
async function fieldOf(db: Db, owner: Owner, key: string): Promise<FlowField | null> {
  if (owner.kind === 'recordType') {
    const t = await db.recordType.findFirst({
      where: { id: owner.id, deletedAt: null },
      select: { definition: true },
    });
    const f = t ? recordDefinitionSchema.parse(t.definition).fields.find((x) => x.key === key) : null;
    return f?.reportable ? f : null;
  }
  const flow = await db.flow.findFirst({
    where: { id: owner.id, deletedAt: null },
    select: { currentVersionId: true },
  });
  const version = flow?.currentVersionId
    ? await db.flowVersion.findUnique({ where: { id: flow.currentVersionId }, select: { definition: true } })
    : null;
  const f = version ? flowFieldMap(flowDefinitionSchema.parse(version.definition)).get(key) : null;
  return f?.reportable ? f : null;
}

/** One batch of records after the cursor, each with its values and links as one object. */
async function batchAfter(db: Db, owner: Owner, cursor: string | null, take: number) {
  if (owner.kind === 'recordType') {
    const rows = await db.recordEntry.findMany({
      where: { typeId: owner.id, deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, data: true },
    });
    return rows.map((r) => ({ id: r.id, data: r.data as unknown }));
  }
  const rows = await db.fmsRecord.findMany({
    where: {
      flowId: owner.id,
      deletedAt: null,
      status: { not: 'CANCELLED' },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: 'asc' },
    take,
    select: {
      id: true,
      data: true,
      steps: { where: { status: 'DONE' }, orderBy: { doneAt: 'asc' }, select: { data: true } },
    },
  });
  return rows.map((r) => ({ id: r.id, data: mergeData(r.data, ...r.steps.map((s) => s.data)) as unknown }));
}

/**
 * The worker's job (every minute): copy the values of existing records for fields that were just marked
 * reportable, a batch at a time. It can be stopped and run again at any point — the cursor says where it was,
 * and writing a copy twice changes nothing. Records saved meanwhile get their copies from the form pipeline.
 */
export async function runBackfills(db: Db, opts: { batch?: number; batches?: number } = {}) {
  const batch = opts.batch ?? 500;
  let left = opts.batches ?? 20;
  let copied = 0;
  const pending = await db.reportBackfill.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  for (const job of pending) {
    const owner = { kind: job.ownerKind as Owner['kind'], id: job.ownerId };
    const field = await fieldOf(db, owner, job.field);
    if (!field) {
      // The field (or its form) went away before the copy finished: nothing to keep.
      await db.reportBackfill.deleteMany({ where: { id: job.id } });
      await db.reportValue.deleteMany({
        where: { ownerKind: owner.kind, ownerId: owner.id, field: job.field },
      });
      continue;
    }
    const tz = (
      await db.company.findUniqueOrThrow({ where: { id: job.companyId }, select: { timezone: true } })
    ).timezone;
    let cursor = job.cursor;
    let done = job.copied;
    while (left > 0) {
      left--;
      const rows = await batchAfter(db, owner, cursor, batch);
      for (const r of rows) {
        const copy = reportCopy(field, plainValues(r.data)[field.key], refsOf(r.data)[field.key], tz);
        await writeCopies(db, { companyId: job.companyId, owner, recordId: r.id }, [
          copy ?? { field: field.key, clear: true },
        ]);
      }
      cursor = rows.at(-1)?.id ?? cursor;
      done += rows.length;
      copied += rows.length;
      const finished = rows.length < batch;
      await db.reportBackfill.update({
        where: { id: job.id },
        data: {
          cursor,
          copied: done,
          total: Math.max(job.total, done),
          status: finished ? 'DONE' : 'PENDING',
        },
      });
      if (finished) break;
    }
    if (left <= 0) break;
  }
  return copied;
}
