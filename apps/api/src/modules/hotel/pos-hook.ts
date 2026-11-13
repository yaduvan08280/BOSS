import type { Db, Tx } from '@mono/db';
import type { ActorContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { hotelFor } from './core';
import { postCharge } from './folio-core';

/**
 * Phase 17 — a restaurant bill sent to a room. Where the outlet's branch is run as a hotel, "room charge" is not
 * money: the bill stays owed and goes on the folio of whoever is checked in to that room, to be paid at
 * check-out. At a branch that is not a hotel the POS keeps its own behaviour (a receipt with the room number).
 */
export type RoomTarget = { stayId: string; number: string; room: string };

export async function roomTarget(
  db: Db | Tx,
  companyId: string,
  branchId: string,
  roomNo: string,
): Promise<RoomTarget | null> {
  const settings = await db.hotelSettings.findUnique({ where: { branchId } });
  if (!settings) return null;
  const room = await db.room.findFirst({
    where: { companyId, branchId, deletedAt: null, number: { equals: roomNo.trim(), mode: 'insensitive' } },
  });
  if (!room) throw new AppError(404, 'NOT_FOUND', `There is no room ${roomNo} here`);
  // Whoever is checked in and whose latest night up to today is in this room (a guest who moved out is not).
  const stays = await db.stay.findMany({ where: { companyId, branchId, status: 'CHECKED_IN' } });
  for (const s of stays) {
    const night = await db.roomNight.findFirst({
      where: { stayId: s.id, day: { lte: settings.businessDate } },
      orderBy: { day: 'desc' },
    });
    if (night?.roomId === room.id) return { stayId: s.id, number: s.number, room: room.number };
  }
  throw new AppError(409, 'CONFLICT', `Nobody is checked in to room ${room.number}`);
}

/** Put the bill's amount on the stay's folio (the routing decides which one); returns the line. */
export async function chargeRoom(
  tx: Tx,
  ctx: ActorContext,
  target: RoomTarget,
  bill: { checkId: string; number: string; outlet: string; amount: number },
) {
  const stay = await tx.stay.findUniqueOrThrow({ where: { id: target.stayId } });
  const hotel = await hotelFor(tx, stay.companyId, stay.branchId);
  const line = await postCharge(tx, ctx, hotel, stay, {
    kind: 'FOOD',
    text: `${bill.outlet} — bill ${bill.number}`,
    amount: bill.amount,
    refType: 'pos_check',
    refId: bill.checkId,
  });
  return line.id;
}

/** The restaurant bill was cancelled: its line comes off the folio. */
export const unchargeRoom = (tx: Tx, lineId: string) =>
  tx.folioLine.updateMany({
    where: { id: lineId, voided: false },
    data: { voided: true, voidReason: 'Restaurant bill cancelled' },
  });
