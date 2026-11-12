import type { Db } from '@mono/db';
import { z } from 'zod';
import type { Actor } from '../work/actor';
import { need } from './access';
import { places } from './ledger';
import type { TransferLine } from './transfers';
import { r3, reachPlaces } from './v2';

export const transferQuery = z.object({
  status: z.string().optional(),
  locationId: z.string().optional(),
});
/** Transfers this person's places are part of (either side), newest first; `inTransit` is what is on the road. */
export async function listTransfers(db: Db, actor: Actor, q: z.infer<typeof transferQuery> = {}) {
  need(actor, 'ims.view', "You can't see stock");
  const mine = await reachPlaces(db, actor.companyId);
  const ids = q.locationId !== undefined ? [q.locationId].filter((x) => mine.has(x)) : [...mine.keys()];
  const rows = await db.stockTransfer.findMany({
    where: {
      companyId: actor.companyId,
      ...(q.status ? { status: q.status } : {}),
      OR: [{ fromLocationId: { in: ids } }, { toLocationId: { in: ids } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const all = await places(db, actor.companyId);
  const itemIds = [
    ...new Set(
      rows.flatMap((r) =>
        (r.lines as TransferLine[])
          .flatMap((l) => [l.itemId, l.substituteItemId])
          .filter((x): x is string => Boolean(x)),
      ),
    ),
  ];
  const names = new Map(
    (
      await db.item.findMany({
        where: { companyId: actor.companyId, id: { in: itemIds } },
        select: { id: true, name: true, unit: true, code: true },
      })
    ).map((i) => [i.id, i]),
  );
  const bills = new Map(
    (
      await db.bill.findMany({
        where: {
          companyId: actor.companyId,
          id: {
            in: rows.flatMap((r) => [r.billId, r.purchaseBillId]).filter((x): x is string => Boolean(x)),
          },
        },
        select: { id: true, number: true, type: true, total: true },
      })
    ).map((b) => [b.id, { id: b.id, number: b.number, type: b.type, total: Number(b.total) }]),
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    kind: r.kind,
    status: r.status,
    from: all.get(r.fromLocationId) ?? null,
    to: all.get(r.toLocationId) ?? null,
    iSupply: mine.has(r.fromLocationId),
    iReceive: mine.has(r.toLocationId),
    note: r.note,
    reason: r.reason,
    approvals: r.approvals,
    createdAt: r.createdAt,
    dispatchedAt: r.dispatchedAt,
    receivedAt: r.receivedAt,
    paper: r.billId ? (bills.get(r.billId) ?? null) : null,
    purchaseBill: r.purchaseBillId ? (bills.get(r.purchaseBillId) ?? null) : null,
    inTransit: r.status === 'DISPATCHED' || r.status === 'RECEIVED',
    lines: (r.lines as TransferLine[]).map((l) => ({
      ...l,
      item: names.get(l.itemId) ?? null,
      substitute: l.substituteItemId ? (names.get(l.substituteItemId) ?? null) : null,
      onTheRoad:
        r.status === 'DISPATCHED' ? l.dispatched : r.status === 'RECEIVED' ? r3(l.short + l.damaged) : 0,
    })),
  }));
}
