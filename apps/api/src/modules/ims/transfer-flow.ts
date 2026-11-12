import type { Db, Tx } from '@mono/db';
import { IN_TRANSIT, transferMachine, transition, type TransferStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { createBillIn } from '../money/bills';
import type { Actor } from '../work/actor';
import { canApprove, ctxOf, imsRulesOf, peoplePayload } from './access';
import { applyMove } from './moves';
import { actsFor, loadTransfer, type TransferLine } from './transfers';
import { clockOf, itemsOf, num, r3, type StockItem } from './v2';

/** The party a branch's legal entity (or the company itself) is on a paper between two of the group's own places. */
export async function selfParty(tx: Tx, companyId: string, entityId: string | null) {
  const id = entityId ? `ent_${entityId}` : `co_${companyId}`;
  const had = await tx.party.findUnique({ where: { id } });
  if (had) return had;
  const entity = entityId ? await tx.legalEntity.findFirst({ where: { id: entityId, companyId } }) : null;
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } });
  return tx.party.create({
    data: {
      id,
      companyId,
      code: `OWN-${(entityId ?? companyId).slice(-4).toUpperCase()}`,
      name: entity?.name ?? company.name,
      kinds: ['company'],
      taxId: entity?.taxId ?? null,
      state: entity?.state ?? null,
    },
  });
}
const entityOf = async (tx: Tx, companyId: string, branchId: string | null) => {
  const b = branchId
    ? await tx.branch.findFirst({ where: { id: branchId, companyId }, select: { entityId: true } })
    : null;
  return b?.entityId ? tx.legalEntity.findFirst({ where: { id: b.entityId, companyId } }) : null;
};

/** The one batch or piece a line travelled as (so a serial-numbered piece is taken out of transit by its number). */
const pieceOf = (line: TransferLine) =>
  line.batchId ?? (line.picks.length === 1 && line.picks[0]!.batchId ? line.picks[0]!.batchId : null);

/** The transfer price of one stock unit: at cost, cost + %, or from a price list (cost when the list lacks it). */
async function priceOf(
  tx: Tx,
  t: { priceRule: string; percent: unknown; priceListId: string | null },
  itemId: string,
  cost: number,
) {
  if (t.priceRule === 'COST_PLUS') return Math.round(cost * (1 + num(t.percent) / 100));
  if (t.priceRule === 'LIST' && t.priceListId) {
    const line = await tx.priceListLine.findUnique({
      where: { listId_itemId: { listId: t.priceListId, itemId } },
    });
    if (line) return Number(line.price);
  }
  return Math.round(cost);
}

export const dispatchSchema = z.object({
  lines: z
    .array(z.object({ itemId: z.string(), qty: z.number().min(0).max(1e9) }))
    .max(200)
    .optional(),
});

/**
 * Dispatch: the goods leave the supplier and are in transit (seen by both sides). Between two branches a paper
 * goes with them: a delivery challan when both are under the same GSTIN, a tax invoice from the sending entity
 * when the GSTINs differ (plan §3.6).
 */
export async function dispatchTransfer(
  db: Db,
  actor: Actor,
  id: string,
  input: z.input<typeof dispatchSchema> = {},
) {
  const d = dispatchSchema.parse(input);
  const { row, from, to, lines } = await loadTransfer(db, actor, id);
  const roles = (await actsFor(db, actor, from, 'ims.edit')) ? (['supplier'] as const) : [];
  const status = transition(transferMachine, {
    from: row.status as TransferStatus,
    action: 'dispatch',
    roles,
    ctx: { differences: false },
  }).to;
  const ids = lines.map((l) => l.substituteItemId ?? l.itemId);
  const { items } = await itemsOf(db, actor.companyId, ids);
  const ctx = ctxOf(actor);
  const { today } = await clockOf(db, actor.companyId);
  return db.$transaction(async (tx) => {
    const sent: { item: StockItem; line: TransferLine }[] = [];
    for (const line of lines) {
      const item = items.get(line.substituteItemId ?? line.itemId)!;
      const want = d.lines?.find((x) => x.itemId === line.itemId)?.qty ?? num(line.approved);
      if (want > num(line.approved) + 1e-9)
        throw new AppError(400, 'VALIDATION_FAILED', `More ${item.name} than was approved`);
      if (want <= 0) continue;
      const r = await applyMove(tx, ctx, {
        itemId: item.id,
        type: 'TRANSFER',
        delta: 0,
        lineQty: want,
        locationId: from.id,
        toLocationId: IN_TRANSIT,
        batchId: line.substituteItemId ? null : (line.batchId ?? null),
        note: `${row.number} to ${to.name}`,
        refType: 'stock_transfer',
        refId: row.id,
      });
      line.dispatched = r3(want);
      line.picks = r.picks.map((p) => ({ batchId: p.batchId, qty: p.qty, value: p.value }));
      line.cost = r.value;
      line.rate = await priceOf(tx, row, item.id, want > 0 ? r.value / want : 0);
      sent.push({ item, line });
    }
    if (!sent.length) throw new AppError(400, 'VALIDATION_FAILED', 'Nothing to dispatch');
    // The paper: only between two branches.
    let billId: string | null = null;
    if (from.branchId && to.branchId && from.branchId !== to.branchId) {
      const [seller, buyer] = [
        await entityOf(tx, actor.companyId, from.branchId),
        await entityOf(tx, actor.companyId, to.branchId),
      ];
      const taxed = Boolean(seller?.taxId && buyer?.taxId && seller.taxId !== buyer.taxId);
      const party = await selfParty(tx, actor.companyId, buyer?.id ?? null);
      const bill = await createBillIn(
        tx,
        actor,
        {
          type: taxed ? 'INVOICE' : 'CHALLAN',
          partyId: party.id,
          date: today,
          branchId: from.branchId,
          lines: sent.map(({ item, line }) => ({
            item: item.name,
            hsn: item.hsn ?? undefined,
            qty: line.dispatched,
            rate: line.rate,
            ...(taxed && item.taxCode ? { taxCode: item.taxCode } : {}),
          })),
          charges: [],
          discount: 0,
          taxInclusive: false,
          note: `${row.number}: ${from.name} to ${to.name}`,
        },
        { issue: true, system: true, source: { type: 'stock_transfer', id: row.id } },
      );
      billId = bill.id;
    }
    await tx.stockTransfer.update({
      where: { id },
      data: { status, lines, dispatchedById: actor.userId, dispatchedAt: new Date(), billId },
    });
    await writeAudit(tx, ctx, {
      action: 'ims.transfer_dispatched',
      entityType: 'stock_transfer',
      entityId: id,
      after: { lines: sent.map((s) => ({ itemId: s.item.id, qty: s.line.dispatched })) },
    });
    await emitEvent(tx, ctx, {
      name: 'ims.transfer_dispatched',
      entityType: 'stock_transfer',
      entityId: id,
      payload: {
        number: row.number,
        from: from.name,
        to: to.name,
        branchId: to.branchId,
        userId: row.requestedById,
        link: '/ims/transfers',
      },
    });
    return { id, status, billId };
  });
}

export const receiveTransferSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string(),
        received: z.number().min(0).max(1e9),
        damaged: z.number().min(0).max(1e9).default(0),
      }),
    )
    .max(200)
    .optional(),
  note: z.string().trim().max(500).nullish(),
  /** Photos of what came short or damaged (attachment ids). */
  photoIds: z.array(z.string()).max(20).optional(),
});

/**
 * Receive: what arrived goes into the asker's stock. What came short or damaged stays in transit, and anything
 * extra is noted — those differences wait for an approval; with none the transfer closes.
 */
export async function receiveTransfer(
  db: Db,
  actor: Actor,
  id: string,
  input: z.input<typeof receiveTransferSchema> = {},
) {
  const r = receiveTransferSchema.parse(input);
  const { row, from, to, lines } = await loadTransfer(db, actor, id);
  const roles = (await actsFor(db, actor, to, 'ims.create')) ? (['receiver'] as const) : [];
  for (const line of lines) {
    if (line.dispatched <= 0) continue;
    const got = r.lines?.find((x) => x.itemId === line.itemId);
    const received = got ? got.received : line.dispatched;
    const damaged = got?.damaged ?? 0;
    line.received = r3(received);
    line.damaged = r3(Math.min(damaged, Math.max(0, line.dispatched - Math.min(received, line.dispatched))));
    line.excess = r3(Math.max(0, received - line.dispatched));
    line.short = r3(Math.max(0, line.dispatched - Math.min(received, line.dispatched) - line.damaged));
  }
  const differences = lines.some((l) => l.short > 0 || l.damaged > 0 || l.excess > 0);
  const status = transition(transferMachine, {
    from: row.status as TransferStatus,
    action: 'receive',
    roles,
    ctx: { differences },
  }).to;
  const ctx = ctxOf(actor);
  const { today } = await clockOf(db, actor.companyId);
  return db.$transaction(async (tx) => {
    for (const line of lines) {
      const take = Math.min(line.received, line.dispatched);
      if (take <= 0) continue;
      await applyMove(tx, ctx, {
        itemId: line.substituteItemId ?? line.itemId,
        type: 'TRANSFER',
        delta: 0,
        lineQty: take,
        locationId: IN_TRANSIT,
        toLocationId: to.id,
        batchId: pieceOf(line),
        note: `${row.number} from ${from.name}`,
        refType: 'stock_transfer',
        refId: row.id,
        // What was dispatched is received whatever its date: it is the receiver who decides what to do with it.
        allowExpired: true,
      });
    }
    // A tax invoice came with the goods: the receiving entity books its purchase from the sending one.
    let purchaseBillId: string | null = null;
    const paper = row.billId ? await tx.bill.findUnique({ where: { id: row.billId } }) : null;
    if (paper?.type === 'INVOICE' && to.branchId) {
      const seller = await entityOf(tx, actor.companyId, from.branchId);
      const party = await selfParty(tx, actor.companyId, seller?.id ?? null);
      const { items } = await itemsOf(
        tx,
        actor.companyId,
        lines.map((l) => l.substituteItemId ?? l.itemId),
      );
      const bill = await createBillIn(
        tx,
        actor,
        {
          type: 'PURCHASE_BILL',
          partyId: party.id,
          date: today,
          branchId: to.branchId,
          reference: paper.number,
          lines: lines
            .filter((l) => l.dispatched > 0)
            .map((l) => {
              const item = items.get(l.substituteItemId ?? l.itemId)!;
              return {
                item: item.name,
                hsn: item.hsn ?? undefined,
                qty: l.dispatched,
                rate: l.rate,
                ...(item.taxCode ? { taxCode: item.taxCode } : {}),
              };
            }),
          charges: [],
          discount: 0,
          taxInclusive: false,
          note: `${row.number}: from ${from.name}`,
        },
        { issue: true, system: true, source: { type: 'stock_transfer_in', id: row.id } },
      );
      purchaseBillId = bill.id;
    }
    await tx.stockTransfer.update({
      where: { id },
      data: {
        status,
        lines,
        receivedById: actor.userId,
        receivedAt: new Date(),
        purchaseBillId,
        note: r.note ?? row.note,
      },
    });
    for (const photoId of r.photoIds ?? [])
      await tx.attachment.updateMany({
        where: { id: photoId, companyId: actor.companyId },
        data: { entityType: 'stock_transfer', entityId: id },
      });
    await writeAudit(tx, ctx, {
      action: 'ims.transfer_received',
      entityType: 'stock_transfer',
      entityId: id,
      after: {
        status,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          received: l.received,
          short: l.short,
          damaged: l.damaged,
          excess: l.excess,
        })),
      },
    });
    await emitEvent(tx, ctx, {
      name: differences ? 'ims.transfer_differences' : 'ims.transfer_received',
      entityType: 'stock_transfer',
      entityId: id,
      payload: {
        ...peoplePayload(await imsRulesOf(tx, actor.companyId)),
        number: row.number,
        from: from.name,
        to: to.name,
        branchId: from.branchId,
        link: '/ims/transfers',
      },
    });
    return { id, status, differences, purchaseBillId };
  });
}

/** The differences are decided by a stock approver: short and damaged are written off, extra is taken in. */
export async function settleTransfer(db: Db, actor: Actor, id: string, note?: string | null) {
  const { row, to, lines } = await loadTransfer(db, actor, id);
  const rules = await imsRulesOf(db, actor.companyId);
  // Whoever received the goods does not decide their own differences (the "never their own" rule).
  if (rules.people.neverOwn && row.receivedById === actor.userId)
    throw new AppError(403, 'FORBIDDEN', 'You received this transfer: someone else decides its differences');
  const roles = (await canApprove(db, actor, rules)) ? (['approver'] as const) : [];
  const status = transition(transferMachine, {
    from: row.status as TransferStatus,
    action: 'settle',
    roles,
    ctx: { differences: true },
  }).to;
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    for (const line of lines) {
      const itemId = line.substituteItemId ?? line.itemId;
      const off = [
        ['LOST', line.short],
        ['DAMAGED', line.damaged],
      ] as const;
      for (const [reason, qty] of off)
        if (qty > 0)
          await applyMove(tx, ctx, {
            itemId,
            type: 'ADJUST',
            delta: -qty,
            reason,
            locationId: IN_TRANSIT,
            batchId: pieceOf(line),
            note: `${row.number}: ${reason.toLowerCase()} on the way`,
            refType: 'stock_transfer',
            refId: row.id,
            allowExpired: true,
          });
      if (line.excess > 0)
        await applyMove(tx, ctx, {
          itemId,
          type: 'ADJUST',
          delta: line.excess,
          reason: 'FOUND',
          locationId: to.id,
          note: `${row.number}: more arrived than was dispatched`,
          refType: 'stock_transfer',
          refId: row.id,
        });
    }
    await tx.stockTransfer.update({
      where: { id },
      data: { status, settledById: actor.userId, note: note ?? row.note },
    });
    await writeAudit(tx, ctx, {
      action: 'ims.transfer_settled',
      entityType: 'stock_transfer',
      entityId: id,
      after: { status, note: note ?? null },
    });
    return { id, status };
  });
}
