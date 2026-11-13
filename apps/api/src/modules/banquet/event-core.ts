import { type BanquetEvent, type Db, type Tx } from '@mono/db';
import {
  addDays,
  advanceNeeded,
  billCovers,
  explode,
  quoteLines,
  slotLabel,
  zonedToUtc,
  type BanquetQuote,
  type BanquetStatus,
} from '@mono/shared';
import { type ActorContext } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { can, type Actor } from '../work/actor';
import { booksOf } from '../ims/recipes';
import { workOutBill } from '../money/bills';
import { dmy, placeOf, type Place } from './core';

/**
 * Phase 18 — a banquet event from enquiry to confirmation: the enquiry (who, when, which halls, how many), the
 * quotation (a menu package per plate, hall rent, extras), and the booking — confirmed once the advance is in,
 * when the halls are held for it and nobody else can be confirmed there for that time.
 */
export const rolesOf = (a: Actor) =>
  can(a, 'hosp.edit') ? (['manager', 'sales'] as const) : (['sales'] as const);
export type Tick = { text: string; dept: string; done: boolean; byId?: string | null; at?: string | null };
export type IndentLine = {
  itemId: string;
  name: string;
  unit: string;
  need: number;
  have: number;
  short: number;
};

export async function eventOf(db: Db | Tx, actor: Actor, id: string) {
  const event = await db.banquetEvent.findFirst({ where: { id, companyId: actor.companyId } });
  if (!event) throw notFound('Event');
  return { event, place: await placeOf(db, actor, event.branchId) };
}
export const instant = (place: Place, day: string, min: number) =>
  zonedToUtc(addDays(day, Math.floor(min / 1440)), min % 1440, place.tz);

/** What the quotation comes to with tax, for the covers it would be billed for today. */
export async function totalsOf(db: Db | Tx, place: Place, e: BanquetEvent) {
  const q = e.quote as BanquetQuote | null;
  if (!q) return { covers: 0, taxable: 0, tax: 0, total: 0 };
  const covers = billCovers(q.guaranteedCovers, e.actualCovers);
  const lines = quoteLines(q, covers);
  if (!lines.length) return { covers, taxable: 0, tax: 0, total: 0 };
  const { totals } = await workOutBill(
    db,
    place.companyId,
    {
      type: 'INVOICE',
      partyId: e.partyId,
      date: place.today,
      branchId: place.branchId,
      lines,
      charges: [],
      discount: q.discount,
      taxInclusive: false,
    },
    place.branchId,
  );
  return { covers, taxable: totals.taxable, tax: totals.tax, total: totals.total };
}
/** Money taken in advance for an event (ADVANCE papers that still stand). */
export async function advancesOf(db: Db | Tx, e: BanquetEvent) {
  const bills = await db.bill.findMany({
    where: {
      companyId: e.companyId,
      sourceType: 'banquet',
      sourceId: e.id,
      type: 'ADVANCE',
      status: { not: 'CANCELLED' },
    },
    orderBy: { createdAt: 'asc' },
  });
  return { bills, paid: bills.reduce((n, b) => n + Number(b.total), 0) };
}

export async function eventView(db: Db | Tx, place: Place, e: BanquetEvent) {
  const [guest, halls, totals, adv, bill] = await Promise.all([
    db.guest.findFirst({ where: { id: e.guestId } }),
    db.hall.findMany({ where: { id: { in: e.hallIds } } }),
    totalsOf(db, place, e),
    advancesOf(db, e),
    e.billId ? db.bill.findUnique({ where: { id: e.billId } }) : null,
  ]);
  return {
    id: e.id,
    number: e.number,
    branchId: e.branchId,
    status: e.status as BanquetStatus,
    occasion: e.occasion,
    day: e.day,
    from: slotLabel(e.startMin),
    to: slotLabel(e.endMin),
    startMin: e.startMin,
    endMin: e.endMin,
    halls: e.hallIds.map((id) => ({ id, name: halls.find((h) => h.id === id)?.name ?? '?' })),
    style: e.style,
    expectedCovers: e.expectedCovers,
    guaranteedCovers: e.guaranteedCovers,
    actualCovers: e.actualCovers,
    guest: guest ? { id: guest.id, name: guest.name, mobile: guest.mobile } : null,
    partyId: e.partyId,
    quote: (e.quote as BanquetQuote | null) ?? null,
    quoteVersion: e.quoteVersion,
    totals,
    advance: { needed: advanceNeeded(place.rules.banquet, totals.total), paid: adv.paid },
    beo: (e.beo as Record<string, string> | null) ?? null,
    beoVersion: e.beoVersion,
    beoSentAt: e.beoSentAt,
    indent: (e.indent as IndentLine[] | null) ?? [],
    checklist: (e.checklist as Tick[] | null) ?? [],
    invoice: bill
      ? {
          id: bill.id,
          number: bill.number,
          total: Number(bill.total),
          due: Math.max(0, Number(bill.total - bill.credited - bill.settled)),
        }
      : null,
    feedback: (e.feedback as { rating: number; comments: string | null } | null) ?? null,
    note: e.note,
    closeReason: e.closeReason,
  };
}

export async function tell(
  tx: Tx,
  ctx: ActorContext,
  name: 'banquet.quoted' | 'banquet.confirmed' | 'banquet.beo',
  place: Place,
  e: BanquetEvent,
  extra: Record<string, unknown> = {},
) {
  const guest = await tx.guest.findFirstOrThrow({ where: { id: e.guestId } });
  const halls = await tx.hall.findMany({ where: { id: { in: e.hallIds } }, select: { name: true } });
  await emitEvent(tx, ctx, {
    name,
    entityType: 'banquet_event',
    entityId: e.id,
    payload: {
      branchId: place.branchId,
      place: place.name,
      number: e.number,
      occasion: e.occasion,
      guest: guest.name,
      customer: guest.name,
      customerMobile: guest.mobile,
      customerEmail: guest.email,
      when: `${dmy(e.day)} ${slotLabel(e.startMin)}–${slotLabel(e.endMin)}`,
      halls: halls.map((h) => h.name).join(', '),
      covers: e.guaranteedCovers ?? e.expectedCovers,
      link: `/hosp/banquets?event=${e.id}`,
      ...extra,
    },
  });
}

/** What the menu needs for a number of covers, against what the stock location holds. */
export async function indentFor(
  db: Db | Tx,
  companyId: string,
  q: BanquetQuote,
  covers: number,
  locationId: string,
): Promise<IndentLine[]> {
  const books = await booksOf(db, companyId);
  const need = new Map<string, number>();
  for (const it of q.items) {
    if (!it.itemId) continue;
    const item = books.items.get(it.itemId);
    if (!item) continue;
    let parts: Map<string, number>;
    try {
      parts =
        item.made === 'DISH'
          ? explode(books, it.itemId, it.perCover * covers)
          : new Map([[it.itemId, it.perCover * covers]]);
    } catch {
      // A dish with no recipe yet asks for nothing: the kitchen sees it has no line.
      continue;
    }
    for (const [id, n] of parts) need.set(id, Math.round(((need.get(id) ?? 0) + n) * 1000) / 1000);
  }
  const ids = [...need.keys()];
  const [items, held] = await Promise.all([
    db.item.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true, unit: true } }),
    db.stockBalance.groupBy({
      by: ['itemId'],
      where: { companyId, locationId, itemId: { in: ids }, qty: { gt: 0 } },
      _sum: { qty: true },
    }),
  ]);
  return items
    .map((i) => {
      const n = need.get(i.id) ?? 0;
      const have = Number(held.find((h) => h.itemId === i.id)?._sum.qty ?? 0);
      return {
        itemId: i.id,
        name: i.name,
        unit: i.unit,
        need: n,
        have,
        short: Math.max(0, Math.round((n - have) * 1000) / 1000),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
