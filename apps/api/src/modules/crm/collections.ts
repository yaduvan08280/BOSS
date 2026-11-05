import type { Db } from '@mono/db';
import { addDays, formatINR, formatLocalDate } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { ctxOf, money, need } from './access';
import { customerBook } from './book';

/**
 * Collections (§11.2): what each customer owes, by age past the due date, what is due today, the latest promise
 * and note; tiles and the ageing totals (the CRM person's escalation chart).
 */
export async function collections(db: Db, actor: Actor) {
  need(actor, 'crm.view', "You can't see collections");
  const { rows, today } = await customerBook(db, actor.companyId);
  const owing = rows
    .filter((r) => r.receivable > 0)
    .sort((a, b) => b.overdue - a.overdue || b.receivable - a.receivable);
  const notes = await db.collectionNote.findMany({
    where: { companyId: actor.companyId, customerId: { in: owing.map((r) => r.id) } },
    orderBy: { createdAt: 'desc' },
  });
  const latest = (id: string, kind?: string) =>
    notes.find((n) => n.customerId === id && (!kind || n.kind === kind));
  const total = (k: keyof (typeof rows)[number]['ageing']) => owing.reduce((a, r) => a + r.ageing[k], 0);
  const week = addDays(today, 7);
  return {
    today,
    rows: owing.map((r) => {
      const promise = latest(r.id, 'promise');
      const note = latest(r.id);
      return {
        customerId: r.id,
        name: r.name,
        city: r.city,
        mobile: r.mobile,
        email: r.email,
        creditDays: r.creditDays,
        receivable: money(r.receivable),
        overdue: money(r.overdue),
        dueToday: money(r.dueToday),
        ageing: Object.fromEntries(Object.entries(r.ageing).map(([k, v]) => [k, money(v)])),
        promisedOn: promise?.promisedOn ?? null,
        promisedAmount: promise?.promisedAmount ? money(promise.promisedAmount) : null,
        brokenPromise: Boolean(promise?.promisedOn && promise.promisedOn < today && r.overdue > 0),
        lastNote: note ? { kind: note.kind, note: note.note, at: note.createdAt } : null,
        tags: r.autoTags,
      };
    }),
    tiles: {
      receivable: money(owing.reduce((a, r) => a + r.receivable, 0)),
      overdue: money(owing.reduce((a, r) => a + r.overdue, 0)),
      dueToday: money(owing.reduce((a, r) => a + r.dueToday, 0)),
      over90: money(total('90_plus')),
      promisedThisWeek: notes.filter(
        (n) => n.kind === 'promise' && n.promisedOn && n.promisedOn >= today && n.promisedOn <= week,
      ).length,
    },
    ageing: {
      '0_30': money(total('0_30')),
      '31_60': money(total('31_60')),
      '61_90': money(total('61_90')),
      '90_plus': money(total('90_plus')),
    },
  };
}

/** One customer's collections log: notes, promises, statements sent, payments. */
export async function collectionLog(db: Db, actor: Actor, customerId: string) {
  need(actor, 'crm.view', "You can't see collections");
  const c = await db.customer.findFirst({
    where: { id: customerId, companyId: actor.companyId, deletedAt: null },
  });
  if (!c) throw notFound('Customer');
  const [notes, payments] = await Promise.all([
    db.collectionNote.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.payment.findMany({ where: { customerId }, orderBy: { date: 'desc' }, take: 100 }),
  ]);
  const by = new Map(
    (
      await db.user.findMany({
        where: {
          id: {
            in: [...notes.map((n) => n.byId), ...payments.map((p) => p.createdById)].filter(
              (x): x is string => Boolean(x),
            ),
          },
        },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return {
    notes: notes.map((n) => ({
      id: n.id,
      kind: n.kind,
      note: n.note,
      promisedOn: n.promisedOn,
      promisedAmount: n.promisedAmount ? money(n.promisedAmount) : null,
      by: n.byId ? (by.get(n.byId) ?? null) : null,
      at: n.createdAt,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: money(p.amount),
      date: p.date,
      mode: p.mode,
      reference: p.reference,
      note: p.note,
      by: p.createdById ? (by.get(p.createdById) ?? null) : null,
    })),
  };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const paymentSchema = z.object({
  customerId: z.string(),
  amount: z.number().int().positive().max(1e15),
  date,
  mode: z.enum(['bank', 'upi', 'cheque', 'cash', 'other']).default('bank'),
  reference: z.string().trim().max(80).nullish(),
  note: z.string().trim().max(300).nullish(),
});

export async function recordPayment(db: Db, actor: Actor, input: z.input<typeof paymentSchema>) {
  need(actor, 'crm.create', "You can't record payments");
  const p = paymentSchema.parse(input);
  const c = await db.customer.findFirst({
    where: { id: p.customerId, companyId: actor.companyId, deletedAt: null },
  });
  if (!c) throw notFound('Customer');
  const { rows, today } = await customerBook(db, actor.companyId, { ids: [c.id] });
  if (p.date > today) throw new AppError(400, 'VALIDATION_FAILED', "A payment can't be dated in the future");
  if (p.amount > rows[0]!.receivable)
    throw new AppError(
      409,
      'CONFLICT',
      `${c.name} owes ${formatINR(rows[0]!.receivable)}; that's more than they owe`,
    );
  return db.$transaction(async (tx) => {
    const row = await tx.payment.create({
      data: { companyId: actor.companyId, ...p, amount: BigInt(p.amount), createdById: actor.userId },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'crm.payment',
      entityType: 'payment',
      entityId: row.id,
      after: p,
    });
    await emitEvent(tx, ctxOf(actor), {
      name: 'crm.payment_received',
      entityType: 'payment',
      entityId: row.id,
      payload: { customerId: c.id, customer: c.name, amountPaise: String(p.amount) },
    });
    return { id: row.id };
  });
}

export const noteSchema = z.object({
  customerId: z.string(),
  note: z.string().trim().min(2).max(500),
  promisedOn: date.nullish(),
  promisedAmount: z.number().int().positive().max(1e15).nullish(),
});

export async function addNote(db: Db, actor: Actor, input: z.input<typeof noteSchema>) {
  need(actor, 'crm.create', "You can't add follow-ups");
  const n = noteSchema.parse(input);
  if (
    !(await db.customer.count({ where: { id: n.customerId, companyId: actor.companyId, deletedAt: null } }))
  )
    throw notFound('Customer');
  return db.$transaction(async (tx) => {
    const row = await tx.collectionNote.create({
      data: {
        companyId: actor.companyId,
        customerId: n.customerId,
        kind: n.promisedOn ? 'promise' : 'note',
        note: n.note,
        promisedOn: n.promisedOn ?? null,
        promisedAmount: n.promisedAmount ? BigInt(n.promisedAmount) : null,
        byId: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'crm.collection_note',
      entityType: 'customer',
      entityId: n.customerId,
      after: n,
    });
    return { id: row.id };
  });
}

/** Send the customer their statement (WhatsApp / email through the payment_due template), and log it. */
export async function sendStatement(db: Db, actor: Actor, customerId: string) {
  need(actor, 'crm.create', "You can't send statements");
  const { rows, today } = await customerBook(db, actor.companyId, { ids: [customerId] });
  const r = rows[0];
  if (!r) throw notFound('Customer');
  if (r.receivable <= 0) throw new AppError(409, 'CONFLICT', `${r.name} owes nothing`);
  if (!r.mobile && !r.email) throw new AppError(409, 'CONFLICT', `${r.name} has no mobile or email`);
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { name: true },
  });
  const firstDue = await db.salesOrder.findFirst({
    where: { customerId, status: { not: 'CANCELLED' } },
    orderBy: { dueOn: 'asc' },
    select: { dueOn: true },
  });
  await db.$transaction(async (tx) => {
    await tx.collectionNote.create({
      data: {
        companyId: actor.companyId,
        customerId,
        kind: 'statement',
        note: `Statement sent: ${formatINR(r.receivable)}`,
        byId: actor.userId,
      },
    });
    await emitEvent(tx, ctxOf(actor), {
      name: 'crm.payment_due',
      entityType: 'customer',
      entityId: customerId,
      payload: {
        customer: r.name,
        customerMobile: r.mobile,
        customerEmail: r.email,
        company: company.name,
        amount: formatINR(r.receivable),
        due: formatLocalDate(r.overdue > 0 ? (firstDue?.dueOn ?? today) : today),
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'crm.statement_sent',
      entityType: 'customer',
      entityId: customerId,
    });
  });
  return { sent: true };
}
