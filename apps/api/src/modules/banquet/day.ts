import type { Db } from '@mono/db';
import {
  banquetMachine,
  billCovers,
  explode,
  quoteLines,
  transition,
  type BanquetQuote,
  type BanquetStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { ctxOf } from '../hosp/access';
import { booksOf, consume } from '../ims/recipes';
import { createBillIn, dueOf } from '../money/bills';
import { applyCredit } from '../money/credit';
import type { Actor } from '../work/actor';
import { dmy, sales } from './core';
import { advancesOf, eventOf, eventView, rolesOf, type Tick } from './event-core';

/**
 * Phase 18 — an event's money and its day: the advance, the BEO to the kitchen, service and housekeeping, the
 * event-day checklist, completing it on the covers that came (the food leaves the stock, the final bill is made
 * and the advance set against it), settling the bill, feedback — or losing the enquiry / cancelling the booking.
 */
export const mode = z.object({
  modeId: z.string().min(1).max(40),
  amount: z.number().int().min(1).max(1e13),
  reference: z.string().trim().max(80).nullish(),
});
export async function modeOf(db: Db, actor: Actor, m: z.infer<typeof mode>) {
  const row = await db.paymentMode.findFirst({
    where: { id: m.modeId, companyId: actor.companyId, deletedAt: null, active: true },
  });
  if (!row || ['COMPANY', 'ROOM', 'COMPLIMENTARY'].includes(row.kind))
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose how the money was paid');
  if (row.needsRef && !m.reference)
    throw new AppError(400, 'VALIDATION_FAILED', `${row.name} needs a reference`);
  return row;
}

export const advanceSchema = mode;
export async function takeAdvance(db: Db, actor: Actor, id: string, input: z.input<typeof mode>) {
  sales(actor);
  const a = mode.parse(input);
  const { event, place } = await eventOf(db, actor, id);
  if (!['QUOTED', 'CONFIRMED'].includes(event.status))
    throw new AppError(409, 'CONFLICT', 'An advance is taken on a quoted or confirmed event');
  const m = await modeOf(db, actor, a);
  await db.$transaction(async (tx) => {
    const bill = await createBillIn(
      tx,
      actor,
      {
        type: 'ADVANCE',
        partyId: event.partyId,
        date: place.today,
        branchId: place.branchId,
        lines: [],
        charges: [],
        discount: 0,
        taxInclusive: false,
        amount: a.amount,
        modeId: m.id,
        reference: a.reference ?? null,
        note: `Banquet ${event.number} — ${event.occasion}, ${dmy(event.day)}`,
      },
      { system: true, source: { type: 'banquet', id: event.id } },
    );
    await writeAudit(tx, ctxOf(actor), {
      action: 'banquet.advance_taken',
      entityType: 'banquet_event',
      entityId: id,
      after: { amount: a.amount, number: bill.number },
    });
  });
  return eventView(db, place, event);
}

export const beoSchema = z.object({
  kitchen: z.string().trim().max(2000).optional(),
  service: z.string().trim().max(2000).optional(),
  housekeeping: z.string().trim().max(2000).optional(),
  /** Send it to the departments now. */
  send: z.boolean().default(false),
});
/** The banquet event order: notes for each department; sending it tells the branch's managers which version is live. */
export async function saveBeo(db: Db, actor: Actor, id: string, input: z.input<typeof beoSchema>) {
  sales(actor);
  const { send, ...notes } = beoSchema.parse(input);
  const { event, place } = await eventOf(db, actor, id);
  if (event.status !== 'CONFIRMED') throw new AppError(409, 'CONFLICT', 'A BEO is for a confirmed event');
  const beo = { ...((event.beo as Record<string, string> | null) ?? {}), ...notes };
  const ctx = ctxOf(actor);
  const row = await db.$transaction(async (tx) => {
    const after = await tx.banquetEvent.update({
      where: { id },
      data: { beo, ...(send ? { beoSentAt: new Date() } : {}) },
    });
    await writeAudit(tx, ctx, {
      action: send ? 'banquet.beo_sent' : 'banquet.beo_saved',
      entityType: 'banquet_event',
      entityId: id,
      after: { version: after.beoVersion, ...notes },
    });
    if (send) {
      const guest = await tx.guest.findFirstOrThrow({ where: { id: event.guestId } });
      const quote = event.quote as BanquetQuote;
      await emitEvent(tx, ctx, {
        name: 'banquet.beo',
        entityType: 'banquet_event',
        entityId: id,
        payload: {
          branchId: place.branchId,
          number: event.number,
          version: after.beoVersion,
          occasion: event.occasion,
          guest: guest.name,
          when: dmy(event.day),
          covers: quote.guaranteedCovers,
          menu: quote.packageName ?? '',
          link: `/hosp/banquets?event=${id}`,
        },
      });
    }
    return after;
  });
  return eventView(db, place, row);
}

export const tickSchema = z.object({
  index: z.number().int().min(0).max(100),
  done: z.boolean().default(true),
});
export async function tickChecklist(db: Db, actor: Actor, id: string, input: z.input<typeof tickSchema>) {
  sales(actor);
  const p = tickSchema.parse(input);
  const { event, place } = await eventOf(db, actor, id);
  const list = [...((event.checklist as Tick[] | null) ?? [])];
  if (event.status !== 'CONFIRMED' || !list[p.index])
    throw new AppError(409, 'CONFLICT', 'This checklist is not open');
  list[p.index] = {
    ...list[p.index]!,
    done: p.done,
    byId: p.done ? actor.userId : null,
    at: p.done ? new Date().toISOString() : null,
  };
  const row = await db.banquetEvent.update({ where: { id }, data: { checklist: list } });
  return eventView(db, place, row);
}

export const completeSchema = z.object({ actualCovers: z.number().int().min(0).max(100000) });
/**
 * The event was held. Its checklist must be done. The food for the covers that came leaves the stock (what the
 * location is short of is noted, never blocking), the final bill is made for the covers that came — never fewer
 * than guaranteed — and the advance is set against it.
 */
export async function completeEvent(db: Db, actor: Actor, id: string, input: z.input<typeof completeSchema>) {
  sales(actor);
  const { actualCovers } = completeSchema.parse(input);
  const { event, place } = await eventOf(db, actor, id);
  const quote = event.quote as BanquetQuote | null;
  const list = (event.checklist as Tick[] | null) ?? [];
  const to = transition(banquetMachine, {
    from: event.status as BanquetStatus,
    action: 'complete',
    roles: rolesOf(actor),
    ctx: { advancePaid: true, checked: list.every((c) => c.done), settled: false },
  }).to;
  if (!quote) throw new AppError(409, 'CONFLICT', 'This event has no quotation');
  const covers = billCovers(quote.guaranteedCovers, actualCovers);
  const ctx = ctxOf(actor);
  const row = await db.$transaction(
    async (tx) => {
      const books = await booksOf(tx, actor.companyId);
      const short: string[] = [];
      for (const it of quote.items) {
        if (!it.itemId || !actualCovers) continue;
        const item = books.items.get(it.itemId);
        if (!item) continue;
        const qty = it.perCover * actualCovers;
        let needs: Map<string, number>;
        try {
          needs = item.made === 'DISH' ? explode(books, it.itemId, qty) : new Map([[it.itemId, qty]]);
        } catch {
          continue;
        }
        const held = await tx.stockBalance.groupBy({
          by: ['itemId'],
          where: {
            companyId: actor.companyId,
            locationId: event.locationId,
            itemId: { in: [...needs.keys()] },
            qty: { gt: 0 },
          },
          _sum: { qty: true },
        });
        const enough = [...needs].every(
          ([k, n]) => Number(held.find((h) => h.itemId === k)?._sum.qty ?? 0) >= n,
        );
        if (!enough) {
          short.push(it.name);
          continue;
        }
        await consume(tx, ctx, {
          itemId: it.itemId,
          qty,
          locationId: event.locationId,
          refType: 'banquet',
          refId: id,
          note: `Banquet ${event.number}`,
        });
      }
      const lines = quoteLines(quote, covers);
      const invoice = lines.length
        ? await createBillIn(
            tx,
            actor,
            {
              type: 'INVOICE',
              partyId: event.partyId,
              date: place.today,
              branchId: place.branchId,
              lines,
              charges: [],
              discount: quote.discount,
              taxInclusive: false,
              note: `Banquet ${event.number} — ${event.occasion}, ${dmy(event.day)}`,
            },
            { issue: true, system: true, source: { type: 'banquet_bill', id } },
          )
        : null;
      if (invoice)
        for (const adv of (await advancesOf(tx, event)).bills) {
          const fresh = await tx.bill.findUniqueOrThrow({ where: { id: invoice.id } });
          if (dueOf(fresh) > 0) await applyCredit(tx, actor.companyId, adv.id, invoice.id, dueOf(fresh));
        }
      const after = await tx.banquetEvent.update({
        where: { id },
        data: {
          status: to,
          actualCovers,
          billId: invoice?.id ?? null,
          note: short.length ? `Stock short for: ${short.join(', ')}` : event.note,
        },
      });
      await writeAudit(tx, ctx, {
        action: 'banquet.completed',
        entityType: 'banquet_event',
        entityId: id,
        before: { status: event.status },
        after: { status: to, actualCovers, billed: covers, invoice: invoice?.number ?? null, short },
      });
      return after;
    },
    { timeout: 30_000 },
  );
  return eventView(db, place, row);
}
