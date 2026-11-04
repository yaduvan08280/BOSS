import { defineMachine } from './transition';

/** CLAUDE.md §9.2 — a leave request: waits for the HOD (Buddies answer alongside), then approved or not. */
export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export type LeaveAction = 'approve' | 'reject' | 'cancel';
export type LeaveRole = 'person' | 'approver' | 'hr' | 'system';
export type LeaveContext = { started: boolean };

export const leaveMachine = defineMachine<LeaveStatus, LeaveAction, LeaveRole, LeaveContext>({
  name: 'leave',
  states: LEAVE_STATUSES,
  terminal: ['REJECTED', 'CANCELLED'],
  rules: [
    { from: 'PENDING', action: 'approve', to: 'APPROVED', roles: ['approver', 'hr', 'system'] },
    { from: 'PENDING', action: 'reject', to: 'REJECTED', roles: ['approver', 'hr'] },
    { from: 'PENDING', action: 'cancel', to: 'CANCELLED', roles: ['person', 'hr'] },
    // An approved leave can be called off until it starts (HR can also end it later).
    { from: 'APPROVED', action: 'cancel', to: 'CANCELLED', roles: ['person'], guard: (c) => !c.started },
    { from: 'APPROVED', action: 'cancel', to: 'CANCELLED', roles: ['hr'] },
  ],
});

/** A Buddy is asked to cover some work; they say yes or no within the rule's hours. */
export const BUDDY_STATUSES = ['ASKED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'] as const;
export type BuddyStatus = (typeof BUDDY_STATUSES)[number];
export type BuddyAction = 'accept' | 'decline' | 'expire' | 'cancel';
export type BuddyRole = 'buddy' | 'person' | 'hr' | 'system';

export const buddyMachine = defineMachine<BuddyStatus, BuddyAction, BuddyRole>({
  name: 'buddy',
  states: BUDDY_STATUSES,
  terminal: ['DECLINED', 'EXPIRED', 'CANCELLED'],
  rules: [
    { from: 'ASKED', action: 'accept', to: 'ACCEPTED', roles: ['buddy'] },
    { from: 'ASKED', action: 'decline', to: 'DECLINED', roles: ['buddy'] },
    { from: 'ASKED', action: 'expire', to: 'EXPIRED', roles: ['system'] },
    { from: ['ASKED', 'ACCEPTED'], action: 'cancel', to: 'CANCELLED', roles: ['person', 'hr', 'system'] },
  ],
});

/** Work handed to a Buddy for a period: scheduled, active while the person is away, then back (or kept). */
export const COVER_STATUSES = ['SCHEDULED', 'ACTIVE', 'RETURNED', 'KEPT', 'CANCELLED'] as const;
export type CoverStatus = (typeof COVER_STATUSES)[number];
export type CoverAction = 'start' | 'return' | 'keep' | 'cancel';

export const coverMachine = defineMachine<CoverStatus, CoverAction, 'system' | 'hr'>({
  name: 'cover',
  states: COVER_STATUSES,
  terminal: ['RETURNED', 'KEPT', 'CANCELLED'],
  rules: [
    { from: 'SCHEDULED', action: 'start', to: 'ACTIVE', roles: ['system', 'hr'] },
    { from: 'ACTIVE', action: 'return', to: 'RETURNED', roles: ['system', 'hr'] },
    { from: 'ACTIVE', action: 'keep', to: 'KEPT', roles: ['system', 'hr'] },
    { from: ['SCHEDULED', 'ACTIVE'], action: 'cancel', to: 'CANCELLED', roles: ['system', 'hr'] },
  ],
});
