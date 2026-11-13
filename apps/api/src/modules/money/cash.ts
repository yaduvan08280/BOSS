import type { Db } from '@mono/db';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';

/**
 * Payment modes and cash books (phase 12M): how money comes in and goes out at a branch — cash, UPI, card, bank,
 * credit — and the day close: for each mode, what the papers of the day say should be there against what was
 * counted. The difference is kept, never corrected silently.
 */
export const MODE_KINDS = [
  'CASH',
  'UPI',
  'CARD',
  'BANK',
  'CREDIT',
  'WALLET',
  'ROOM',
  'COMPANY',
  'COMPLIMENTARY',
] as const;
export const modeSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(MODE_KINDS),
  branchId: z.string().max(40).nullish(),
  active: z.boolean().default(true),
  /** A reference must be typed when money is taken this way (UTR, slip number, room number). */
  needsRef: z.boolean().default(false),
});

const needAdmin = (a: Actor) => {
  if (!can(a, 'money.admin'))
    throw new AppError(403, 'FORBIDDEN', 'Only the accounts admin sets payment modes');
};

export async function listModes(db: Db, actor: Actor, branchId?: string | null) {
  return db.paymentMode.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}),
    },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  });
}

export async function saveMode(db: Db, actor: Actor, input: z.infer<typeof modeSchema>, id?: string) {
  needAdmin(actor);
  if (
    input.branchId &&
    !(await db.branch.count({ where: { id: input.branchId, companyId: actor.companyId } }))
  )
    throw notFound('Branch');
  const data = {
    name: input.name,
    kind: input.kind,
    branchId: input.branchId ?? null,
    active: input.active,
    needsRef: input.needsRef ?? false,
  };
  if (id) {
    const res = await db.paymentMode.updateMany({ where: { id, companyId: actor.companyId }, data });
    if (!res.count) throw notFound('Payment mode');
    return db.paymentMode.findUniqueOrThrow({ where: { id } });
  }
  return db.paymentMode.create({ data: { ...data, companyId: actor.companyId } });
}

/** What came in less what went out by one mode at one branch on one day, from the day's money papers. */
async function expectedFor(db: Db, companyId: string, branchId: string, date: string) {
  const papers = await db.bill.findMany({
    where: {
      companyId,
      branchId,
      date,
      type: { in: ['RECEIPT', 'ADVANCE', 'VENDOR_PAYMENT'] },
      status: { not: 'CANCELLED' },
      modeId: { not: null },
    },
    select: { modeId: true, type: true, total: true },
  });
  const by = new Map<string, number>();
  for (const p of papers)
    by.set(p.modeId!, (by.get(p.modeId!) ?? 0) + (p.type === 'VENDOR_PAYMENT' ? -1 : 1) * Number(p.total));
  return by;
}

/** The day's close sheet for a branch: each mode with what is expected, and what was counted once closed. */
export async function dayClose(db: Db, actor: Actor, branchId: string, date: string) {
  if (!can(actor, 'money.view')) throw new AppError(403, 'FORBIDDEN', "You can't see the day close");
  const [modes, expected, closed] = await Promise.all([
    listModes(db, actor, branchId),
    expectedFor(db, actor.companyId, branchId, date),
    db.dayClose.findMany({ where: { companyId: actor.companyId, branchId, date } }),
  ]);
  return {
    branchId,
    date,
    modes: modes
      .filter((m) => m.active || expected.has(m.id))
      .map((m) => {
        const c = closed.find((x) => x.modeId === m.id);
        return {
          modeId: m.id,
          name: m.name,
          kind: m.kind,
          expected: c ? Number(c.expected) : (expected.get(m.id) ?? 0),
          counted: c ? Number(c.counted) : null,
          difference: c ? Number(c.counted - c.expected) : null,
          note: c?.note ?? null,
        };
      }),
    closed: closed.length > 0,
  };
}

/** Close a day: the counted amount of each mode is written next to what the papers expect. Once. */
export async function closeDay(
  db: Db,
  actor: Actor,
  input: {
    branchId: string;
    date: string;
    counts: { modeId: string; counted: number; note?: string | null }[];
  },
) {
  if (!can(actor, 'money.edit')) throw new AppError(403, 'FORBIDDEN', "You can't close the day");
  if (!(await db.branch.count({ where: { id: input.branchId, companyId: actor.companyId } })))
    throw notFound('Branch');
  if (
    await db.dayClose.count({
      where: { companyId: actor.companyId, branchId: input.branchId, date: input.date },
    })
  )
    throw new AppError(409, 'CONFLICT', 'This day is already closed');
  const expected = await expectedFor(db, actor.companyId, input.branchId, input.date);
  const modes = await listModes(db, actor, input.branchId);
  const missing = [...expected.keys()].filter((id) => !input.counts.some((c) => c.modeId === id));
  if (missing.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Count every mode that took money today', {
      modes: missing.map((id) => modes.find((m) => m.id === id)?.name ?? id),
    });
  await db.$transaction(async (tx) => {
    for (const c of input.counts) {
      if (!modes.some((m) => m.id === c.modeId)) throw notFound('Payment mode');
      await tx.dayClose.create({
        data: {
          companyId: actor.companyId,
          branchId: input.branchId,
          date: input.date,
          modeId: c.modeId,
          expected: BigInt(expected.get(c.modeId) ?? 0),
          counted: BigInt(c.counted),
          note: c.note ?? null,
          closedById: actor.userId,
        },
      });
    }
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'day.closed',
        entityType: 'branch',
        entityId: input.branchId,
        after: { date: input.date, counts: input.counts },
      },
    );
  });
  return dayClose(db, actor, input.branchId, input.date);
}
