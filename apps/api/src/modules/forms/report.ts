import { Prisma, type Db, type Tx } from '@mono/db';
import { localDate, showStored, type FlowField } from '@mono/shared';
import type { FormOwner, FormStage } from './index';

/** Owners whose records can be reported on (masters are lists, not records). */
const REPORTED: FormOwner['kind'][] = ['flow', 'recordType'];
const NUMBERS = ['number', 'amount', 'formula'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export type ReportCopy = {
  field: string;
  text: string | null;
  norm: string | null;
  number: number | null;
  /** YYYY-MM-DD */
  day: string | null;
  ref: string | null;
};

/**
 * The typed copy of one value (plan §2.7): text for what people read (and its lower-case form for matching),
 * a number for numbers / amounts / formulas that gave a number (item lines count as their total), a day for
 * dates (the company-local day of a date-time), and the link of a picked row. null = nothing to keep.
 */
export function reportCopy(f: FlowField, v: unknown, ref: string | undefined, tz: string): ReportCopy | null {
  if (v === undefined || v === null || v === '') return null;
  const copy: ReportCopy = {
    field: f.key,
    text: null,
    norm: null,
    number: null,
    day: null,
    ref: ref ?? null,
  };
  if (Array.isArray(v) && f.type === 'items') {
    const sum = (v as { amount?: unknown }[]).reduce((a, l) => a + (Number(l?.amount) || 0), 0);
    if (!v.length) return null;
    copy.number = Math.round(sum * 100) / 100;
  } else if (typeof v === 'number' && NUMBERS.includes(f.type)) copy.number = v;
  else if (
    typeof v === 'string' &&
    (f.type === 'date' || (f.type === 'formula' && DAY.test(v))) &&
    DAY.test(v)
  )
    copy.day = v;
  else if (typeof v === 'string' && (f.type === 'datetime' || f.type === 'formula') && INSTANT.test(v))
    copy.day = localDate(new Date(v), tz);
  const text = showStored(f, v, tz);
  if (text === null && copy.number === null && copy.day === null) return null;
  copy.text = text === null ? null : text.slice(0, 500);
  copy.norm = copy.text === null ? null : copy.text.trim().toLowerCase().replace(/\s+/g, ' ');
  return copy;
}

/** Write (or clear) the copies of some fields of one record. One statement per field; idempotent. */
export async function writeCopies(
  tx: Db | Tx,
  at: { companyId: string; owner: FormOwner; recordId: string },
  copies: (ReportCopy | { field: string; clear: true })[],
) {
  for (const c of copies) {
    if ('clear' in c) {
      await tx.reportValue.deleteMany({
        where: { ownerKind: at.owner.kind, ownerId: at.owner.id, recordId: at.recordId, field: c.field },
      });
      continue;
    }
    const data = {
      text: c.text,
      norm: c.norm,
      number: c.number === null ? null : new Prisma.Decimal(c.number),
      day: c.day === null ? null : new Date(`${c.day}T00:00:00.000Z`),
      ref: c.ref,
    };
    await tx.reportValue.upsert({
      where: {
        ownerKind_ownerId_recordId_field: {
          ownerKind: at.owner.kind,
          ownerId: at.owner.id,
          recordId: at.recordId,
          field: c.field,
        },
      },
      create: {
        companyId: at.companyId,
        ownerKind: at.owner.kind,
        ownerId: at.owner.id,
        recordId: at.recordId,
        field: c.field,
        ...data,
      },
      update: data,
    });
  }
}

const tzOf = async (db: Db | Tx, companyId: string) =>
  (await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } })).timezone;

/**
 * Reportable fields (plan §2.7): when a form is saved, each field marked "reportable" keeps a typed, indexed
 * copy of its value for this record — in the same transaction, so a report never disagrees with the record.
 * A field emptied on a later save loses its copy. Cancelling or deleting the record removes its copies.
 */
export const reportStage: FormStage = {
  name: 'report',
  async commit(tx, scope, fields, state) {
    if (!scope.recordId || !REPORTED.includes(scope.owner.kind)) return;
    const marked = fields.filter((f) => f.reportable);
    if (!marked.length) return;
    const tz = await tzOf(tx, scope.companyId);
    await writeCopies(
      tx,
      { companyId: scope.companyId, owner: scope.owner, recordId: scope.recordId },
      marked.map(
        (f) => reportCopy(f, state.values[f.key], state.refs[f.key], tz) ?? { field: f.key, clear: true },
      ),
    );
  },
  async release(tx, target) {
    if (!REPORTED.includes(target.owner.kind)) return;
    await tx.reportValue.deleteMany({
      where: { ownerKind: target.owner.kind, ownerId: target.owner.id, recordId: target.recordId },
    });
  },
};
