import type { Db, HkTask, Tx } from '@mono/db';
import {
  hkTaskMachine,
  roomHkMachine,
  roomState,
  transition,
  type HkTaskStatus,
  type RoomHkStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import { applyMove } from '../ims/moves';
import { can, type Actor } from '../work/actor';
import { desk, hotelOf, seer, supervisor, type Hotel } from './core';

/**
 * Phase 17 — housekeeping. Every room has a status (dirty, clean, inspected, out of order / service); the day's
 * board lists the rooms to clean with who does each, a checklist per room, an inspection, the minibar check
 * (what was taken goes on the guest's folio and off the stock), linen and amenities issued, turndown, and the
 * lost & found register.
 */
type Tick = { text: string; done: boolean };
const taskView = (t: HkTask) => ({
  id: t.id,
  roomId: t.roomId,
  day: t.day,
  kind: t.kind,
  assigneeId: t.assigneeId,
  status: t.status as HkTaskStatus,
  checklist: t.checklist as Tick[],
  minibar: (t.minibar as { itemId: string; name: string; qty: number }[] | null) ?? [],
  note: t.note,
});
const rolesOf = (a: Actor) =>
  can(a, 'hosp.edit') ? (['supervisor', 'attendant'] as const) : (['attendant'] as const);

/** The stay in each room tonight (checked in). */
export async function occupants(db: Db | Tx, hotel: Hotel) {
  const stays = await db.stay.findMany({
    where: { companyId: hotel.companyId, branchId: hotel.branchId, status: 'CHECKED_IN' },
  });
  const out = new Map<string, (typeof stays)[number]>();
  for (const s of stays) {
    const n = await db.roomNight.findFirst({
      where: { stayId: s.id, day: { lte: hotel.businessDate } },
      orderBy: { day: 'desc' },
    });
    if (n?.roomId) out.set(n.roomId, s);
  }
  return out;
}

/** Lay out the day: a cleaning task for every room that is dirty or has a guest in it (made once a room a day). */
export async function planDay(tx: Tx, hotel: Hotel) {
  const rooms = await tx.room.findMany({
    where: { companyId: hotel.companyId, branchId: hotel.branchId, deletedAt: null },
  });
  const inRoom = await occupants(tx, hotel);
  let made = 0;
  for (const r of rooms) {
    if (['OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(r.hkStatus)) continue;
    if (r.hkStatus !== 'DIRTY' && !inRoom.has(r.id)) continue;
    const had = await tx.hkTask.findUnique({
      where: { roomId_day_kind: { roomId: r.id, day: hotel.businessDate, kind: 'CLEAN' } },
    });
    if (had) continue;
    await tx.hkTask.create({
      data: {
        companyId: hotel.companyId,
        branchId: hotel.branchId,
        roomId: r.id,
        day: hotel.businessDate,
        kind: 'CLEAN',
        checklist: hotel.rules.hkChecklist.map((text) => ({ text, done: false })),
      },
    });
    made++;
  }
  return made;
}

export async function board(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  const hotel = await hotelOf(db, actor, branchId);
  const where = { companyId: actor.companyId, branchId };
  const [rooms, tasks, inRoom, types] = await Promise.all([
    db.room.findMany({ where: { ...where, deletedAt: null } }),
    db.hkTask.findMany({ where: { ...where, day: hotel.businessDate } }),
    occupants(db, hotel),
    db.roomType.findMany({ where }),
  ]);
  const guests = await db.guest.findMany({
    where: { id: { in: [...inRoom.values()].map((s) => s.guestId) } },
  });
  const list = rooms
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
    .map((r) => {
      const stay = inRoom.get(r.id);
      return {
        id: r.id,
        number: r.number,
        floor: r.floor,
        type: types.find((t) => t.id === r.typeId)?.name ?? '',
        hkStatus: r.hkStatus as RoomHkStatus,
        state: roomState(r.hkStatus as RoomHkStatus, Boolean(stay)),
        guest: stay ? (guests.find((g) => g.id === stay.guestId)?.name ?? null) : null,
        stayId: stay?.id ?? null,
        departs: stay?.depart ?? null,
        tasks: tasks.filter((t) => t.roomId === r.id).map(taskView),
      };
    });
  const count = (s: string) => list.filter((r) => r.state === s).length;
  return {
    businessDate: hotel.businessDate,
    minibar: hotel.rules.minibar,
    counts: {
      toClean: tasks.filter((t) => t.kind === 'CLEAN' && t.status === 'OPEN').length,
      toInspect: tasks.filter((t) => t.status === 'DONE').length,
      vacantClean: count('VACANT_CLEAN') + count('INSPECTED'),
      vacantDirty: count('VACANT_DIRTY'),
      occupied: count('OCCUPIED') + count('OCCUPIED_DIRTY'),
      outOfOrder: count('OUT_OF_ORDER') + count('OUT_OF_SERVICE'),
    },
    rooms: list,
  };
}

export const planSchema = z.object({
  branchId: z.string().min(1),
  /** Turndown for the rooms that have a guest tonight. */
  turndown: z.boolean().default(false),
});
export async function planBoard(db: Db, actor: Actor, input: z.input<typeof planSchema>) {
  supervisor(actor);
  const p = planSchema.parse(input);
  const hotel = await hotelOf(db, actor, p.branchId);
  return db.$transaction(async (tx) => {
    const cleaning = await planDay(tx, hotel);
    let turndown = 0;
    if (p.turndown)
      for (const roomId of (await occupants(tx, hotel)).keys()) {
        const key = { roomId_day_kind: { roomId, day: hotel.businessDate, kind: 'TURNDOWN' } };
        if (await tx.hkTask.findUnique({ where: key })) continue;
        await tx.hkTask.create({
          data: {
            companyId: actor.companyId,
            branchId: p.branchId,
            roomId,
            day: hotel.businessDate,
            kind: 'TURNDOWN',
            checklist: [{ text: 'Bed turned down, curtains drawn', done: false }],
          },
        });
        turndown++;
      }
    return { cleaning, turndown };
  });
}

export const assignSchema = z.object({
  branchId: z.string().min(1),
  assigneeId: z.string().min(1),
  /** Every open task of a floor, or the tasks named. */
  floor: z.string().max(20).nullish(),
  taskIds: z.array(z.string().min(1)).max(300).optional(),
});
export async function assignTasks(db: Db, actor: Actor, input: z.input<typeof assignSchema>) {
  supervisor(actor);
  const p = assignSchema.parse(input);
  const hotel = await hotelOf(db, actor, p.branchId);
  const person = await db.user.findFirst({
    where: { id: p.assigneeId, companyId: actor.companyId, deletedAt: null, status: 'ACTIVE' },
  });
  if (!person) throw notFound('Person');
  const rooms = await db.room.findMany({
    where: { companyId: actor.companyId, branchId: p.branchId, ...(p.floor ? { floor: p.floor } : {}) },
    select: { id: true },
  });
  const res = await db.hkTask.updateMany({
    where: {
      companyId: actor.companyId,
      branchId: p.branchId,
      day: hotel.businessDate,
      status: 'OPEN',
      ...(p.taskIds ? { id: { in: p.taskIds } } : { roomId: { in: rooms.map((r) => r.id) } }),
    },
    data: { assigneeId: p.assigneeId },
  });
  return { assigned: res.count };
}

export const taskSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('tick'),
    index: z.number().int().min(0).max(60),
    done: z.boolean().default(true),
  }),
  z.object({ action: z.literal('done'), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal('inspect') }),
  z.object({ action: z.literal('redo'), note: z.string().trim().min(3).max(300) }),
]);
/** Work a housekeeping task: tick its lines, mark it done (the room is clean), inspect it, or send it back. */
export async function actOnTask(db: Db, actor: Actor, taskId: string, input: z.input<typeof taskSchema>) {
  desk(actor);
  const p = taskSchema.parse(input);
  const task = await db.hkTask.findFirst({ where: { id: taskId, companyId: actor.companyId } });
  if (!task) throw notFound('Task');
  const hotel = await hotelOf(db, actor, task.branchId);
  const ticks = [...(task.checklist as Tick[])];
  const ctx = ctxOf(actor);
  if (p.action === 'tick') {
    if (task.status !== 'OPEN' || !ticks[p.index])
      throw new AppError(409, 'CONFLICT', 'This task is not open');
    ticks[p.index] = { ...ticks[p.index]!, done: p.done };
    return taskView(await db.hkTask.update({ where: { id: taskId }, data: { checklist: ticks } }));
  }
  const roles = rolesOf(actor);
  const to = transition(hkTaskMachine, {
    from: task.status as HkTaskStatus,
    action: p.action,
    roles,
    ctx: { ticked: ticks.every((t) => t.done) },
  }).to;
  return db.$transaction(async (tx) => {
    const room = await tx.room.findUniqueOrThrow({ where: { id: task.roomId } });
    if (task.kind === 'CLEAN' && !['OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(room.hkStatus)) {
      const move = p.action === 'done' ? 'clean' : p.action === 'inspect' ? 'inspect' : 'fail';
      // A room cleaned twice in a day is simply clean; anything else follows the room's own machine.
      if (!(move === 'clean' && room.hkStatus !== 'DIRTY'))
        await tx.room.update({
          where: { id: room.id },
          data: {
            hkStatus: transition(roomHkMachine, {
              from: room.hkStatus as RoomHkStatus,
              action: move,
              roles,
              ctx: { service: false },
            }).to,
          },
        });
      // Linen and amenities for the room come out of the housekeeping store; short stock is noted, never blocking.
      if (p.action === 'done')
        for (const a of hotel.rules.amenities) {
          const held = await tx.stockBalance.aggregate({
            where: { itemId: a.itemId, locationId: hotel.rules.hkLocationId, qty: { gt: 0 } },
            _sum: { qty: true },
          });
          if (Number(held._sum.qty ?? 0) < a.qty) continue;
          await applyMove(tx, ctx, {
            itemId: a.itemId,
            type: 'OUT',
            delta: -a.qty,
            reason: 'HOUSEKEEPING',
            locationId: hotel.rules.hkLocationId,
            refType: 'housekeeping',
            refId: task.id,
            note: `Room ${room.number}`,
          });
        }
    }
    const after = await tx.hkTask.update({
      where: { id: taskId },
      data: {
        status: to,
        ...(p.action === 'done'
          ? { doneAt: new Date(), doneById: actor.userId, note: p.note ?? task.note }
          : {}),
        ...(p.action === 'inspect' ? { inspectedById: actor.userId } : {}),
        ...(p.action === 'redo'
          ? { note: p.note, checklist: ticks.map((t) => ({ ...t, done: false })), doneAt: null }
          : {}),
      },
    });
    await writeAudit(tx, ctx, {
      action: `hotel.hk_${p.action}`,
      entityType: 'room',
      entityId: room.id,
      before: { status: task.status },
      after: { status: to, room: room.number },
    });
    return taskView(after);
  });
}
