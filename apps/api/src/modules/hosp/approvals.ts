import { Prisma, type Db } from '@mono/db';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf } from './access';
import { makeCheckIn } from './checks';
import { cancelCheckIn, refund } from './payments';
import { isApprover, posOutlet } from './pos-core';
import { applyVoid } from './voids';

export const decideSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(200).nullish() });
/** An approver's answer to a void, a discount or a bill cancellation above someone's limit — never their own ask. */
export async function decideApproval(db: Db, actor: Actor, id: string, input: z.input<typeof decideSchema>) {
  const d = decideSchema.parse(input);
  const a = await db.posApproval.findFirst({ where: { id, companyId: actor.companyId } });
  if (!a) throw notFound('Request');
  if (a.status !== 'PENDING') throw new AppError(409, 'CONFLICT', 'That request is already decided');
  const outlet = await posOutlet(db, actor, a.outletId);
  if (!(await isApprover(db, actor, outlet.rules)))
    throw new AppError(403, 'FORBIDDEN', "You can't approve this");
  if (a.askedById === actor.userId)
    throw new AppError(403, 'FORBIDDEN', "You can't approve your own request");
  const asker = { ...actor, userId: a.askedById } as Actor;
  const ask = a.ask as Record<string, unknown>;
  if (d.approve && a.kind === 'CANCEL_BILL') {
    const check = await db.posCheck.findUniqueOrThrow({ where: { id: String(ask.checkId) } });
    await refund(db, actor, check.payments);
  }
  await db.$transaction(async (tx) => {
    if (a.kind === 'VOID') {
      if (d.approve)
        await applyVoid(
          tx,
          asker,
          outlet,
          String(ask.itemId),
          String(ask.reason ?? ''),
          Boolean(ask.cooked),
          actor.userId,
        );
      else
        await tx.posOrderItem.updateMany({
          where: { id: String(ask.itemId) },
          data: { voidAsk: Prisma.DbNull },
        });
    } else if (a.kind === 'DISCOUNT' && d.approve) {
      const order = await tx.posOrder.findUniqueOrThrow({
        where: { id: a.orderId },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });
      await makeCheckIn(tx, asker, outlet, order, ask.check as never, actor.userId);
    } else if (a.kind === 'CANCEL_BILL' && d.approve) {
      await cancelCheckIn(tx, asker, outlet, String(ask.checkId), String(ask.reason), actor.userId);
    }
    await tx.posApproval.update({
      where: { id },
      data: {
        status: d.approve ? 'APPROVED' : 'REJECTED',
        decidedById: actor.userId,
        decidedAt: new Date(),
        note: d.note ?? null,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: `pos.approval_${d.approve ? 'approved' : 'rejected'}`,
      entityType: 'pos_approval',
      entityId: id,
      after: { kind: a.kind, note: d.note ?? null },
    });
  });
  return { id, status: d.approve ? 'APPROVED' : 'REJECTED' };
}
