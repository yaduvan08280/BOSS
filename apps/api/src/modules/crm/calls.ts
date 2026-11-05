import type { Db } from '@mono/db';
import {
  addDays,
  CALL_RESULTS,
  callMachine,
  CRR_SEATS,
  formatINR,
  formatLocalDate,
  transition,
  zonedToUtc,
  type CallStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { crmRole, ctxOf, money, need, seatPeople } from './access';
import { customerBook, type BookRow } from './book';
import { createOrder, orderSchema } from './orders';
import { monthTargets } from './targets';

/** The SC who calls a customer: whoever handles them if they hold a CRR seat, else the first CRR SC. */
async function scFor(db: Db, companyId: string, row: BookRow, crr: string[]) {
  return row.handledById && crr.includes(row.handledById)
    ? row.handledById
    : (crr[0] ?? row.handledById ?? null);
}

/**
 * The calls for today (worker, once a day; also on opening Today's Calls): SCOT customers whose call date has come
 * (or whose "later" date has), and a win-back call every 30 days for sleeping and lost customers. Open SCOT calls
 * of customers who ordered anyway are cancelled. New SCOT calls tell their SC.
 */
export async function generateCalls(db: Db, companyId: string) {
  const { rows, today, config } = await customerBook(db, companyId);
  const crr = [
    ...new Set((await Promise.all(CRR_SEATS.map((s) => seatPeople(db, companyId, s, config)))).flat()),
  ];
  const calls = await db.call.findMany({ where: { companyId }, orderBy: { dueOn: 'desc' } });
  const latest = new Map<string, (typeof calls)[number]>();
  for (const c of calls) if (!latest.has(c.customerId)) latest.set(c.customerId, c);
  let made = 0;
  for (const r of rows) {
    const last = latest.get(r.id);
    // They ordered after the call was due: nothing to ask any more.
    if (last?.status === 'OPEN' && last.kind === 'scot' && r.lastOrder && r.lastOrder >= last.dueOn) {
      transition(callMachine, { from: 'OPEN', action: 'cancel', roles: ['system'], ctx: {} });
      await db.call.update({ where: { id: last.id }, data: { status: 'CANCELLED', note: 'Ordered anyway' } });
      latest.delete(r.id);
    } else if (last?.status === 'OPEN') continue;
    const prev = latest.get(r.id);
    let dueOn: string | null = null;
    let kind: 'scot' | 'winback' = 'scot';
    const quiet = r.autoTags.includes('sleeping') || r.autoTags.includes('lost');
    if (prev?.status === 'DONE' && prev.nextOn && prev.nextOn > today) continue;
    if (prev?.status === 'DONE' && prev.nextOn && prev.nextOn <= today) dueOn = prev.nextOn;
    else if (
      r.scot.onScot &&
      r.scot.callOn &&
      r.scot.callOn <= today &&
      (!prev || prev.dueOn < r.scot.callOn)
    )
      dueOn = r.scot.callOn;
    else if (quiet && !r.scot.onScot && (!prev || prev.dueOn <= addDays(today, -30))) {
      dueOn = today;
      kind = 'winback';
    }
    if (!dueOn) continue;
    // Sleeping and lost customers get win-back calls (even when SCOT still lists sleeping ones).
    if (quiet) kind = 'winback';
    const scId = await scFor(db, companyId, r, crr);
    await db.$transaction(async (tx) => {
      const call = await tx.call.create({ data: { companyId, customerId: r.id, scId, dueOn, kind } });
      if (kind === 'scot' && scId)
        await emitEvent(
          tx,
          { companyId, actorId: null },
          {
            name: 'crm.call_due',
            entityType: 'call',
            entityId: call.id,
            payload: {
              scId,
              customer: r.name,
              average: formatINR(r.scot.averageOrder, { compact: true }),
              every: r.scot.everyDays,
              last: r.lastOrder ? formatLocalDate(r.lastOrder) : '—',
              link: '/crm/calls',
            },
          },
        );
    });
    made++;
  }
  return made;
}

/** SCOT sheet (§11.2): every regular customer's rhythm and next call, the tiles, the calls per day and the CRR gap. */
export async function scotSheet(db: Db, actor: Actor) {
  need(actor, 'crm.view', "You can't see SCOT");
  const { rows, today, config, f } = await customerBook(db, actor.companyId);
  const on = rows.filter((r) => r.scot.onScot);
  const open = await db.call.findMany({
    where: { companyId: actor.companyId, status: 'OPEN' },
    select: { customerId: true, dueOn: true, scId: true },
  });
  const openBy = new Map(open.map((c) => [c.customerId, c]));
  const ids = [
    ...new Set(
      rows
        .map((r) => r.handledById)
        .concat(open.map((c) => c.scId))
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [
      u.id,
      u.name,
    ]),
  );
  const in30 = addDays(today, 30);
  // Calls per day for the next 30 days (a customer called every 12 days shows up more than once).
  const perDay: Record<string, number> = {};
  for (const r of on) {
    for (let d = r.scot.callOn!, k = 0; d <= in30 && k < 40; d = addDays(d, r.scot.everyDays!), k++)
      if (d >= today) perDay[d] = (perDay[d] ?? 0) + 1;
  }
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, i)).map((d) => ({
    date: d,
    calls: perDay[d] ?? 0,
    working: f.isWorking(d),
  }));
  const expected = on
    .filter((r) => r.scot.nextDue && r.scot.nextDue <= in30)
    .reduce((a, r) => a + r.scot.averageOrder, 0);
  const target = await monthTargets(db, actor.companyId, today);
  const quiet = rows.filter((r) => r.autoTags.includes('sleeping') || r.autoTags.includes('lost')).length;
  return {
    today,
    settings: config.scot,
    rows: on.map((r) => {
      const call = openBy.get(r.id);
      const sc = call?.scId ?? r.handledById;
      return {
        customerId: r.id,
        name: r.name,
        city: r.city,
        mobile: r.mobile,
        ...r.scot,
        averageOrder: money(r.scot.averageOrder),
        callBeforeDays: config.scot.callBeforeDays,
        overdue: Boolean(r.scot.callOn && r.scot.callOn < today),
        openCall: Boolean(call),
        scId: sc,
        sc: sc ? (names.get(sc) ?? null) : null,
        sleeping: r.autoTags.includes('sleeping'),
      };
    }),
    tiles: {
      onScot: on.length,
      callsToday: on.filter((r) => r.scot.callOn === today).length,
      overdue: on.filter((r) => r.scot.callOn! < today).length,
      next7: on.filter((r) => r.scot.callOn! >= today && r.scot.callOn! <= addDays(today, 7)).length,
      expected30: money(expected),
    },
    days,
    gap: {
      crrTarget: money(target.crr),
      scotExpects: money(expected),
      gap: money(Math.max(0, target.crr - expected)),
      sleepingLost: quiet,
    },
  };
}

/** Today's Calls (§11.2): open calls due by today, the ones done today, and the tiles. SCs see their own. */
export async function todaysCalls(db: Db, actor: Actor, scId?: string) {
  need(actor, 'crm.view', "You can't see calls");
  await generateCalls(db, actor.companyId);
  const role = await crmRole(db, actor);
  const { rows, today, f } = await customerBook(db, actor.companyId);
  const sc = role.all ? scId : actor.userId;
  const calls = await db.call.findMany({
    where: {
      companyId: actor.companyId,
      ...(sc ? { scId: sc } : {}),
      OR: [
        { status: 'OPEN', dueOn: { lte: today } },
        { status: 'DONE', resultAt: { gte: zonedToUtc(today, 0, f.tz) } },
      ],
    },
    orderBy: { dueOn: 'asc' },
  });
  const book = new Map(rows.map((r) => [r.id, r]));
  const taken = await db.salesOrder.aggregate({
    where: {
      companyId: actor.companyId,
      callId: { in: calls.map((c) => c.id) },
      status: { not: 'CANCELLED' },
      orderDate: today,
    },
    _sum: { amount: true },
  });
  const target = await monthTargets(db, actor.companyId, today);
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: calls.map((c) => c.scId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return {
    today,
    calls: calls.map((c) => {
      const r = book.get(c.customerId)!;
      return {
        id: c.id,
        kind: c.kind,
        status: c.status,
        result: c.result,
        dueOn: c.dueOn,
        lateDays:
          c.status === 'OPEN'
            ? Math.max(0, Math.round((Date.parse(today) - Date.parse(c.dueOn)) / 86_400_000))
            : 0,
        note: c.note,
        scId: c.scId,
        sc: c.scId ? (names.get(c.scId) ?? null) : null,
        customer: { id: r.id, name: r.name, city: r.city, mobile: r.mobile, creditDays: r.creditDays },
        averageOrder: money(r.scot.averageOrder),
        everyDays: r.scot.everyDays,
        lastOrder: r.lastOrder,
        nextDue: r.scot.nextDue,
        topItems: r.scot.topItems,
        tags: r.autoTags,
      };
    }),
    tiles: {
      due: calls.filter((c) => c.status === 'OPEN' && c.kind === 'scot').length,
      done: calls.filter((c) => c.status === 'DONE').length,
      takenToday: money(taken._sum.amount ?? 0),
      crrToday: money(target.crrPerDay),
      winBack: calls.filter((c) => c.status === 'OPEN' && c.kind === 'winback').length,
    },
    canPickSc: role.all,
  };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const answerSchema = z
  .object({
    result: z.enum(CALL_RESULTS),
    note: z.string().trim().max(500).nullish(),
    nextOn: date.nullish(),
    lostReason: z.string().trim().min(3).max(300).nullish(),
    order: orderSchema.omit({ customerId: true }).optional(),
  })
  .refine((a) => a.result !== 'LATER' || a.nextOn, {
    path: ['nextOn'],
    message: 'When should we call again?',
  })
  .refine((a) => a.result !== 'LOST' || a.lostReason, {
    path: ['lostReason'],
    message: 'Why was the customer lost?',
  })
  .refine((a) => a.result !== 'ORDER' || a.order, { path: ['order'], message: 'The order taken' });

/**
 * The result of a call: order taken (→ CRM Orders + the after-order flow), call later (a date), not now (the next
 * cycle), or lost (why → the customer goes to win-back calls).
 */
export async function answerCall(db: Db, actor: Actor, id: string, input: z.input<typeof answerSchema>) {
  need(actor, 'crm.create', "You can't record calls");
  const a = answerSchema.parse(input);
  const call = await db.call.findFirst({ where: { id, companyId: actor.companyId } });
  if (!call) throw notFound('Call');
  const role = await crmRole(db, actor);
  if (!role.all && call.scId && call.scId !== actor.userId)
    throw new AppError(403, 'FORBIDDEN', 'This call is for someone else');
  transition(callMachine, { from: call.status as CallStatus, action: 'answer', roles: ['sales'], ctx: {} });
  const { rows, today } = await customerBook(db, actor.companyId, { ids: [call.customerId] });
  const r = rows[0]!;
  if (a.result === 'LATER' && a.nextOn! < today)
    throw new AppError(400, 'VALIDATION_FAILED', "Call later can't be in the past");
  const nextOn =
    a.result === 'LATER' ? a.nextOn! : a.result === 'NOT_NOW' ? addDays(today, r.scot.everyDays ?? 30) : null;
  const order =
    a.result === 'ORDER'
      ? await createOrder(db, actor, { ...a.order!, customerId: call.customerId }, call.id)
      : null;
  await db.$transaction(async (tx) => {
    await tx.call.update({
      where: { id },
      data: {
        status: 'DONE',
        result: a.result,
        resultAt: new Date(),
        doneById: actor.userId,
        note: a.note ?? null,
        nextOn,
        orderId: order?.id ?? null,
      },
    });
    if (a.result === 'LOST')
      await tx.customer.update({
        where: { id: call.customerId },
        data: { lostAt: new Date(), lostReason: a.lostReason! },
      });
    await writeAudit(tx, ctxOf(actor), {
      action: 'crm.call_answered',
      entityType: 'call',
      entityId: id,
      after: { ...a, order: order?.number },
    });
  });
  return { result: a.result, nextOn, order };
}
