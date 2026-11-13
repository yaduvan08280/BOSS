import { defineMachine } from './transition';

/**
 * Phase 17 — the hotel. A stay is booked, checked in, checked out; a booking can be cancelled or become a
 * no-show before the guest arrives. A room's housekeeping status follows what happens to it.
 */
export const STAY_STATUSES = ['BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const;
export type StayStatus = (typeof STAY_STATUSES)[number];
export type StayAction = 'checkIn' | 'checkOut' | 'cancel' | 'noShow' | 'reinstate';
export type StayRole = 'desk' | 'system';
/** `room`: a room is assigned and ready. `kyc`: the guest's ID is written down. `settled`: no folio is still open. */
export type StayContext = { room: boolean; kyc: boolean; settled: boolean };

export const stayMachine = defineMachine<StayStatus, StayAction, StayRole, StayContext>({
  name: 'stay',
  states: STAY_STATUSES,
  terminal: ['CHECKED_OUT', 'CANCELLED'],
  rules: [
    { from: 'BOOKED', action: 'checkIn', to: 'CHECKED_IN', roles: ['desk'], guard: (c) => c.room && c.kyc },
    { from: 'CHECKED_IN', action: 'checkOut', to: 'CHECKED_OUT', roles: ['desk'], guard: (c) => c.settled },
    { from: 'BOOKED', action: 'cancel', to: 'CANCELLED', roles: ['desk', 'system'] },
    { from: 'BOOKED', action: 'noShow', to: 'NO_SHOW', roles: ['desk', 'system'] },
    // The guest arrived a day late: the booking is live again for the nights that are left.
    { from: 'NO_SHOW', action: 'reinstate', to: 'BOOKED', roles: ['desk'] },
  ],
});

/** A room for housekeeping. Occupied or vacant is read from the stays, not kept here. */
export const ROOM_HK_STATUSES = ['DIRTY', 'CLEAN', 'INSPECTED', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'] as const;
export type RoomHkStatus = (typeof ROOM_HK_STATUSES)[number];
export type RoomHkAction = 'dirty' | 'clean' | 'inspect' | 'fail' | 'block' | 'release';
export type RoomHkRole = 'attendant' | 'supervisor' | 'system';
export const roomHkMachine = defineMachine<RoomHkStatus, RoomHkAction, RoomHkRole, { service: boolean }>({
  name: 'room_hk',
  states: ROOM_HK_STATUSES,
  rules: [
    // A night slept in, or a check-out.
    {
      from: ['CLEAN', 'INSPECTED', 'DIRTY'],
      action: 'dirty',
      to: 'DIRTY',
      roles: ['system', 'supervisor', 'attendant'],
    },
    { from: 'DIRTY', action: 'clean', to: 'CLEAN', roles: ['attendant', 'supervisor'] },
    { from: 'CLEAN', action: 'inspect', to: 'INSPECTED', roles: ['supervisor'] },
    // The inspection found it wanting: it is cleaned again.
    { from: ['CLEAN', 'INSPECTED'], action: 'fail', to: 'DIRTY', roles: ['supervisor'] },
    {
      from: ['DIRTY', 'CLEAN', 'INSPECTED'],
      action: 'block',
      to: (c) => (c.service ? 'OUT_OF_SERVICE' : 'OUT_OF_ORDER'),
      roles: ['supervisor', 'system'],
    },
    // Back from maintenance: it must be cleaned before it is sold.
    {
      from: ['OUT_OF_ORDER', 'OUT_OF_SERVICE'],
      action: 'release',
      to: 'DIRTY',
      roles: ['supervisor', 'system'],
    },
  ],
});

export const HK_TASK_STATUSES = ['OPEN', 'DONE', 'INSPECTED'] as const;
export type HkTaskStatus = (typeof HK_TASK_STATUSES)[number];
export const hkTaskMachine = defineMachine<
  HkTaskStatus,
  'done' | 'inspect' | 'redo',
  'attendant' | 'supervisor',
  { ticked: boolean }
>({
  name: 'hk_task',
  states: HK_TASK_STATUSES,
  terminal: ['INSPECTED'],
  rules: [
    // Every line of the checklist must be ticked.
    { from: 'OPEN', action: 'done', to: 'DONE', roles: ['attendant', 'supervisor'], guard: (c) => c.ticked },
    { from: 'DONE', action: 'inspect', to: 'INSPECTED', roles: ['supervisor'] },
    { from: 'DONE', action: 'redo', to: 'OPEN', roles: ['supervisor'] },
  ],
});
