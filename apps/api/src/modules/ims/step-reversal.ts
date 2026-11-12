import type { Db, FmsRecord, StockMove, Tx } from '@mono/db';
import { adjustMachine, transition } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { log } from '../fms/engine-helpers';
import type { Actor } from '../work/actor';
import { askApprovers } from './access';
import { applyMove, show } from './moves';

type Rec = Pick<FmsRecord, 'id' | 'companyId' | 'title' | 'number'>;

/**
 * Undo the stock a record's steps moved (L17) — all of it (the record is cancelled) or only some step rows' (a
 * rejected approval sent the record back over them). Nothing is edited or deleted: every applied move gets one
 * new move pointing at it (`reversesId`, unique — so never twice); lines still waiting for an approver are
 * withdrawn through the adjust machine. A reversal that can't be applied (a receipt whose stock is already
 * used) does not stop the record: it waits for an approver as a PENDING move and is noted on the record.
 */
export async function reverseStock(
  tx: Tx,
  record: Rec,
  o: { stepIds?: string[]; why: string; actorId: string | null },
) {
  if (o.stepIds && !o.stepIds.length) return;
  const moves = await tx.stockMove.findMany({
    where: {
      companyId: record.companyId,
      refType: 'fms_record',
      refId: record.id,
      status: { in: ['APPLIED', 'PENDING'] },
      // Not a reversal itself, and not undone already.
      reversesId: null,
      reversedBy: { is: null },
      ...(o.stepIds ? { stepId: { in: o.stepIds } } : {}),
    },
    include: { item: { select: { name: true, unit: true } } },
  });
  if (!moves.length) return;
  // Give stock back before taking any away, so a receipt and a later issue of the same item both unwind.
  const rank = (m: (typeof moves)[number]) => (m.type === 'OUT' ? 0 : m.type === 'IN' ? 2 : 1);
  moves.sort((a, b) => rank(a) - rank(b));
  const ctx = { companyId: record.companyId, actorId: o.actorId };
  const note = `Reversal · ${record.title} #${record.number} · ${o.why}`;
  const stuck: string[] = [];
  let undone = 0;
  let withdrawn = 0;
  for (const m of moves) {
    if (m.status === 'PENDING') {
      transition(adjustMachine, {
        from: 'PENDING',
        action: 'withdraw',
        roles: ['system'],
        ctx: { own: false, neverOwn: false },
      });
      await tx.stockMove.update({
        where: { id: m.id },
        data: { status: 'REJECTED', decidedAt: new Date(), decisionNote: `Withdrawn — ${o.why}` },
      });
      withdrawn++;
      continue;
    }
    const qty = Number(m.qty);
    const base = {
      ...{ itemId: m.itemId, note, refType: 'fms_record', refId: record.id, rate: m.rate },
      ...{ stepId: m.stepId, reversesId: m.id, lineQty: m.lineQty === null ? null : Number(m.lineQty) },
    };
    try {
      if (m.type === 'TRANSFER') {
        await applyMove(tx, ctx, {
          ...base,
          ...{ type: 'TRANSFER', delta: 0, fromLocation: m.toLocation, toLocation: m.fromLocation },
        });
        // Back to "no location" when it had none before.
        if (!m.fromLocation) await tx.item.update({ where: { id: m.itemId }, data: { location: null } });
      } else {
        await applyMove(tx, ctx, {
          ...base,
          ...{ type: qty < 0 ? 'IN' : 'OUT', delta: -qty },
          ...{ fromLocation: m.toLocation, toLocation: m.fromLocation },
        });
      }
      undone++;
    } catch (e) {
      // Taking a receipt back needs the stock to still be there; it changed nothing, so the transaction is good.
      if (!(e instanceof AppError) || e.code !== 'CONFLICT') throw e;
      const held = await tx.stockMove.create({
        data: {
          ...{ companyId: record.companyId, itemId: m.itemId, type: 'OUT', qty: -qty, rate: m.rate },
          ...{ status: 'PENDING', createdById: o.actorId, stepId: m.stepId, reversesId: m.id },
          ...{ refType: 'fms_record', refId: record.id, lineQty: m.lineQty },
          note: `${note} · could not be taken back`,
        },
      });
      await askApprovers(tx, ctx, held.id, {
        item: m.item.name,
        qty: `-${show(qty)} ${m.item.unit}`,
        reason: `reversal · ${record.title} #${record.number} · ${e.message}`,
      });
      stuck.push(`${m.item.name}: ${show(qty)} ${m.item.unit} could not be taken back (${e.message})`);
    }
  }
  const text = [
    `Stock reversed (${o.why}): ${undone} move(s)`,
    ...(withdrawn ? [`${withdrawn} waiting line(s) withdrawn`] : []),
    ...(stuck.length ? [...stuck, 'the store keeper has been told'] : []),
  ].join(' · ');
  await log(tx, record, 'note', { actorId: o.actorId, note: text });
  await writeAudit(tx, ctx, {
    action: 'ims.stock_reversed',
    entityType: 'fms_record',
    entityId: record.id,
    after: { why: o.why, undone, withdrawn, stuck: stuck.length, moves: moves.map((m) => m.id) },
  });
}

/** An approver decided a step's waiting line: say so on the record's history. */
export async function noteStepDecision(
  tx: Tx,
  move: Pick<StockMove, 'itemId' | 'qty' | 'refId' | 'stepId' | 'reversesId' | 'companyId'>,
  approved: boolean,
  actorId: string,
  note?: string | null,
) {
  const record = move.refId
    ? await tx.fmsRecord.findFirst({ where: { id: move.refId, companyId: move.companyId } })
    : null;
  if (!record) return;
  const item = await tx.item.findUniqueOrThrow({ where: { id: move.itemId } });
  const row = move.stepId ? await tx.fmsRecordStep.findUnique({ where: { id: move.stepId } }) : null;
  const what = `${item.name} ${show(Math.abs(Number(move.qty)))} ${item.unit}`;
  const said = note?.trim() ? `: ${note.trim()}` : '';
  const text = move.reversesId
    ? approved
      ? `Stock reversal applied after approval: ${what}`
      : `Stock reversal dropped by the approver: ${what}${said}`
    : approved
      ? `Stock issued after approval: ${what}`
      : `Stock not issued — the approver said no: ${what}${said}`;
  await log(tx, record, 'note', { stepKey: row?.stepKey, actorId, note: text });
}

/** A record's stock moves, for its drawer: what each step moved, what waits, what was reversed. */
export async function recordStock(db: Db, actor: Actor, recordId: string) {
  const record = await db.fmsRecord.findFirst({
    where: { id: recordId, companyId: actor.companyId, deletedAt: null },
    select: { id: true },
  });
  if (!record) throw notFound('Record');
  const moves = await db.stockMove.findMany({
    where: { companyId: actor.companyId, refType: 'fms_record', refId: record.id },
    orderBy: { createdAt: 'asc' },
    include: {
      item: { select: { code: true, name: true, unit: true } },
      reversedBy: { select: { status: true } },
    },
  });
  // Moves of one step are made in one transaction (one time): keep them in a steady order, by item code.
  moves.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.item.code.localeCompare(b.item.code),
  );
  return moves.map((m) => ({
    id: m.id,
    stepId: m.stepId,
    type: m.type,
    status: m.status,
    qty: Number(m.lineQty ?? Math.abs(Number(m.qty))),
    item: m.item,
    fromLocation: m.fromLocation,
    toLocation: m.toLocation,
    at: m.at,
    reversal: Boolean(m.reversesId),
    /** Undone by a later move (APPLIED), or its reversal still waits for an approver (PENDING). */
    reversed: m.reversedBy?.status ?? null,
  }));
}
