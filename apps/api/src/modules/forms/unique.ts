import { Prisma, type Db, type Tx } from '@mono/db';
import type { FlowField } from '@mono/shared';
import { AppError } from '../../lib/errors';
import type { FormScope, FormStage, FormState, FormTarget } from './index';

/** How a value is compared: as text, ignoring case and surrounding spaces. Empty and non-scalar values hold nothing. */
export function uniqueKey(v: unknown): string | null {
  if (v === undefined || v === null || typeof v === 'object') return null;
  const s = String(v).trim().toLowerCase();
  return s ? s.slice(0, 300) : null;
}

const uniqueFields = (fields: FlowField[]) => fields.filter((f) => f.unique && f.type !== 'formula');
const taken = (f: FlowField, v: unknown) => `${f.label}: "${String(v).trim()}" is already used`;

/**
 * Values held by records saved before the field was made unique (they have no row in `unique_values`): a plain
 * look through the owner's live records. Only the table's unique index is race-safe; this is for history.
 */
async function usedBefore(db: Db | Tx, scope: FormScope, field: string, value: string): Promise<boolean> {
  const { companyId, owner } = scope;
  const not = scope.recordId ?? '';
  if (owner.kind === 'flow') {
    const hit = await db.$queryRaw<unknown[]>(Prisma.sql`
      SELECT 1 FROM fms_records r
       WHERE r.company_id = ${companyId} AND r.flow_id = ${owner.id} AND r.id <> ${not}
         AND r.deleted_at IS NULL AND r.status <> 'CANCELLED'
         AND (lower(btrim(r.data ->> ${field})) = ${value}
           OR EXISTS (SELECT 1 FROM fms_record_steps s
                       WHERE s.record_id = r.id AND s.status = 'DONE'
                         AND lower(btrim(s.data ->> ${field})) = ${value}))
       LIMIT 1`);
    return hit.length > 0;
  }
  if (owner.kind === 'master') {
    const hit = await db.$queryRaw<unknown[]>(Prisma.sql`
      SELECT 1 FROM master_rows r
       WHERE r.company_id = ${companyId} AND r.master_id = ${owner.id} AND r.id <> ${not}
         AND r.deleted_at IS NULL AND lower(btrim(r.data ->> ${field})) = ${value}
       LIMIT 1`);
    return hit.length > 0;
  }
  return false;
}

/** Refuse a value another live record of the same owner already holds. A record never trips over its own value. */
async function check(db: Db | Tx, scope: FormScope, fields: FlowField[], state: FormState) {
  for (const f of uniqueFields(fields)) {
    const value = uniqueKey(state.values[f.key]);
    if (!value || state.errors[f.key]) continue;
    const held = await db.uniqueValue.findFirst({
      where: {
        companyId: scope.companyId,
        ownerKind: scope.owner.kind,
        ownerId: scope.owner.id,
        field: f.key,
        value,
      },
      select: { recordId: true },
    });
    if (held ? held.recordId !== scope.recordId : await usedBefore(db, scope, f.key, value))
      state.errors[f.key] = taken(f, state.values[f.key]);
  }
}

/**
 * Claim the values, in the transaction that saves the record. The database's unique index decides between two
 * people saving the same value at the same moment: the second insert waits for the first save to finish, finds
 * the value taken, and that save is refused.
 */
async function commit(tx: Tx, scope: FormScope, fields: FlowField[], state: FormState) {
  const mine = uniqueFields(fields);
  if (!mine.length) return;
  const recordId = scope.recordId;
  // A new record must be given the id it will be created with (see `FormScope.recordId`).
  if (!recordId) throw new Error('A form with unique fields was saved without scope.recordId');
  const at = { companyId: scope.companyId, ownerKind: scope.owner.kind, ownerId: scope.owner.id };
  for (const f of mine) {
    const value = uniqueKey(state.values[f.key]);
    // What this record held in the field before (a step done again, a row edited) is given back.
    await tx.uniqueValue.deleteMany({
      where: { ...at, field: f.key, recordId, ...(value ? { value: { not: value } } : {}) },
    });
    if (!value) continue;
    const made = await tx.uniqueValue.createMany({
      data: [{ ...at, field: f.key, value, recordId }],
      skipDuplicates: true,
    });
    if (made.count) continue;
    const holder = await tx.uniqueValue.findFirst({ where: { ...at, field: f.key, value } });
    if (holder?.recordId !== recordId) {
      const message = taken(f, state.values[f.key]);
      throw new AppError(400, 'VALIDATION_FAILED', message, { fields: { [f.key]: message } });
    }
  }
}

/** The record is cancelled or deleted: its values can be used again. */
async function release(tx: Tx, target: FormTarget) {
  await tx.uniqueValue.deleteMany({
    where: {
      companyId: target.companyId,
      ownerKind: target.owner.kind,
      ownerId: target.owner.id,
      recordId: target.recordId,
    },
  });
}

/** Unique values (§2.2): a value already used in another live record of the same owner is refused. */
export const uniqueStage: FormStage = { name: 'unique', check, commit, release };
