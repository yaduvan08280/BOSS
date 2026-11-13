import { defineMachine } from './transition';

/**
 * Phase 16 — a table reservation: asked for → confirmed → reminded → the guest arrives → seated (the POS order
 * opens on the table) → finished. It can be cancelled until the guest is seated; a confirmed booking whose guest
 * never came is a no-show (and can be brought back if they turn up late).
 */
export const RESERVATION_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'REMINDED',
  'ARRIVED',
  'SEATED',
  'FINISHED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export type ReservationAction =
  'confirm' | 'remind' | 'arrive' | 'seat' | 'finish' | 'cancel' | 'noShow' | 'restore';
export type ReservationRole = 'staff' | 'guest' | 'system';
/** `depositDue`: a deposit is asked and not yet paid. `pastHold`: the hold time after the booking has passed. */
export type ReservationContext = { depositDue: boolean; pastHold: boolean };

/** Statuses that keep a table: nobody else can book it for that time. */
export const HOLDING_STATUSES: readonly ReservationStatus[] = [
  'REQUESTED',
  'CONFIRMED',
  'REMINDED',
  'ARRIVED',
  'SEATED',
];

export const reservationMachine = defineMachine<
  ReservationStatus,
  ReservationAction,
  ReservationRole,
  ReservationContext
>({
  name: 'reservation',
  states: RESERVATION_STATUSES,
  terminal: ['FINISHED', 'CANCELLED'],
  rules: [
    // A booking that owes a deposit is confirmed only once it is paid.
    {
      from: 'REQUESTED',
      action: 'confirm',
      to: 'CONFIRMED',
      roles: ['staff', 'system'],
      guard: (c) => !c.depositDue,
    },
    { from: 'CONFIRMED', action: 'remind', to: 'REMINDED', roles: ['system', 'staff'] },
    { from: ['CONFIRMED', 'REMINDED'], action: 'arrive', to: 'ARRIVED', roles: ['staff'] },
    { from: ['CONFIRMED', 'REMINDED', 'ARRIVED'], action: 'seat', to: 'SEATED', roles: ['staff'] },
    { from: 'SEATED', action: 'finish', to: 'FINISHED', roles: ['staff', 'system'] },
    {
      from: ['REQUESTED', 'CONFIRMED', 'REMINDED', 'ARRIVED'],
      action: 'cancel',
      to: 'CANCELLED',
      roles: ['staff', 'guest', 'system'],
    },
    // Staff may mark it at any time; the system only once the hold time has passed.
    { from: ['CONFIRMED', 'REMINDED'], action: 'noShow', to: 'NO_SHOW', roles: ['staff'] },
    {
      from: ['CONFIRMED', 'REMINDED'],
      action: 'noShow',
      to: 'NO_SHOW',
      roles: ['system'],
      guard: (c) => c.pastHold,
    },
    { from: 'NO_SHOW', action: 'restore', to: 'CONFIRMED', roles: ['staff'] },
  ],
});

/** A party on the waitlist: waiting → called ("your table is ready") → seated; or it left. */
export const WAITLIST_STATUSES = ['WAITING', 'CALLED', 'SEATED', 'LEFT'] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];
export type WaitlistAction = 'call' | 'seat' | 'leave';
export const waitlistMachine = defineMachine<WaitlistStatus, WaitlistAction, 'staff'>({
  name: 'waitlist',
  states: WAITLIST_STATUSES,
  terminal: ['SEATED', 'LEFT'],
  rules: [
    { from: 'WAITING', action: 'call', to: 'CALLED', roles: ['staff'] },
    { from: ['WAITING', 'CALLED'], action: 'seat', to: 'SEATED', roles: ['staff'] },
    { from: ['WAITING', 'CALLED'], action: 'leave', to: 'LEFT', roles: ['staff'] },
  ],
});
