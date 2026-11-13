import type { Db } from '@mono/db';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { dayNumber, loadOrder } from './pos-core';

const steward = (a: Actor) => need(a, 'hosp.create', "You can't take orders");

export const tableOpSchema = z.discriminatedUnion('op', [
  /** The order moves to other table(s). */
  z.object({ op: z.literal('MOVE'), tableIds: z.array(z.string()).min(1).max(12) }),
  /** Another table's order is joined into this one. */
  z.object({ op: z.literal('MERGE'), fromOrderId: z.string() }),
  /** Some items go to another table: its running order, or a new one there. */
  z.object({
    op: z.literal('TRANSFER'),
    itemIds: z.array(z.string()).min(1).max(200),
    toTableId: z.string(),
  }),
  z.object({ op: z.literal('STEWARD'), stewardId: z.string() }),
]);
/** Table operations: move, merge, split off / transfer items, change the steward. */
export async function tableOp(db: Db, actor: Actor, orderId: string, input: z.input<typeof tableOpSchema>) {
  steward(actor);
  const op = tableOpSchema.parse(input);
  const { order, outlet } = await loadOrder(db, actor, orderId);
  if (order.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This order is already billed');
  const running = (tableIds: string[], notId?: string) =>
    db.posOrder.findFirst({
      where: {
        companyId: actor.companyId,
        outletId: outlet.id,
        status: { in: ['OPEN', 'BILLED'] },
        tableIds: { hasSome: tableIds },
        ...(notId ? { NOT: { id: notId } } : {}),
      },
      include: { items: true },
    });
  const tablesOk = async (ids: string[]) => {
    if (
      (await db.diningTable.count({
        where: { companyId: actor.companyId, outletId: outlet.id, id: { in: ids }, deletedAt: null },
      })) !== new Set(ids).size
    )
      throw new AppError(400, 'VALIDATION_FAILED', 'A table is not one of this outlet’s');
  };
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    let result: Record<string, unknown> = {};
    if (op.op === 'MOVE') {
      await tablesOk(op.tableIds);
      if (await running(op.tableIds, order.id))
        throw new AppError(409, 'CONFLICT', 'That table already has an order running');
      await tx.posOrder.update({ where: { id: order.id }, data: { tableIds: op.tableIds } });
    } else if (op.op === 'MERGE') {
      const from = await tx.posOrder.findFirst({
        where: { id: op.fromOrderId, companyId: actor.companyId, outletId: outlet.id, status: 'OPEN' },
      });
      if (!from || from.id === order.id) throw new AppError(409, 'CONFLICT', 'That order can’t be joined');
      await tx.posOrderItem.updateMany({
        where: { orderId: from.id },
        data: { orderId: order.id, checkNo: 1 },
      });
      await tx.kot.updateMany({ where: { orderId: from.id }, data: { orderId: order.id } });
      await tx.posOrder.update({
        where: { id: order.id },
        data: {
          tableIds: [...new Set([...order.tableIds, ...from.tableIds])],
          covers: order.covers + from.covers,
        },
      });
      await tx.posOrder.update({
        where: { id: from.id },
        data: {
          status: 'CANCELLED',
          closedAt: new Date(),
          tableIds: [],
          note: `Joined into order ${order.number}`,
        },
      });
    } else if (op.op === 'TRANSFER') {
      await tablesOk([op.toTableId]);
      const moving = order.items.filter((i) => op.itemIds.includes(i.id) && i.status !== 'VOID');
      if (moving.length !== op.itemIds.length)
        throw new AppError(400, 'VALIDATION_FAILED', 'An item is not on this order');
      let target = await running([op.toTableId], order.id);
      if (target && target.status !== 'OPEN')
        throw new AppError(409, 'CONFLICT', 'That table is already billed');
      if (!target) {
        const made = await tx.posOrder.create({
          data: {
            companyId: actor.companyId,
            branchId: outlet.branchId,
            outletId: outlet.id,
            number: await dayNumber(tx, actor.companyId, 'order', outlet.id, order.businessDay),
            businessDay: order.businessDay,
            type: 'DINE_IN',
            tableIds: [op.toTableId],
            covers: 1,
            stewardId: order.stewardId,
            createdById: actor.userId,
          },
        });
        target = { ...made, items: [] };
      }
      await tx.posOrderItem.updateMany({
        where: { id: { in: op.itemIds } },
        data: { orderId: target.id, checkNo: 1 },
      });
      result = { toOrderId: target.id };
    } else {
      if (
        !(await tx.user.count({ where: { id: op.stewardId, companyId: actor.companyId, deletedAt: null } }))
      )
        throw notFound('Person');
      await tx.posOrder.update({ where: { id: order.id }, data: { stewardId: op.stewardId } });
    }
    await writeAudit(tx, ctx, {
      action: `pos.table_${op.op.toLowerCase()}`,
      entityType: 'pos_order',
      entityId: order.id,
      after: op,
    });
    return { ok: true, ...result };
  });
}
