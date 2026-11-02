import { defineMachine } from './transition';

/** CLAUDE.md §5.3: problem → solutions → decision. Approving creates a linked delegation task. */
export const SLIP_STATUSES = [
  'SUBMITTED',
  'RETURNED',
  'WITH_APPROVER',
  'APPROVED',
  'REJECTED',
  'CLOSED',
  'WITHDRAWN',
] as const;
export type SlipStatus = (typeof SLIP_STATUSES)[number];
export const SLIP_ACTIONS = [
  'forward',
  'return',
  'resubmit',
  'approve',
  'reject',
  'close',
  'withdraw',
] as const;
export type SlipAction = (typeof SLIP_ACTIONS)[number];
export type SlipRole = 'raiser' | 'receiver' | 'approver' | 'admin' | 'system';
export type SlipContext = { receiverScreens: boolean; approverStep: boolean };

/** Where a (re)submitted slip lands: with the receiver to screen, or straight with the approver. */
export const slipEntryStatus = (c: SlipContext): SlipStatus =>
  c.receiverScreens || !c.approverStep ? 'SUBMITTED' : 'WITH_APPROVER';

const OPEN_SLIP = ['SUBMITTED', 'RETURNED', 'WITH_APPROVER'] as const;

export const slipMachine = defineMachine<SlipStatus, SlipAction, SlipRole, SlipContext>({
  name: 'slip',
  states: SLIP_STATUSES,
  terminal: ['CLOSED', 'WITHDRAWN'],
  rules: [
    {
      from: 'SUBMITTED',
      action: 'forward',
      to: 'WITH_APPROVER',
      roles: ['receiver', 'admin'],
      guard: (c) => c.approverStep,
    },
    { from: 'SUBMITTED', action: 'return', to: 'RETURNED', roles: ['receiver', 'admin'] },
    { from: 'RETURNED', action: 'resubmit', to: slipEntryStatus, roles: ['raiser'] },
    // With the approver step switched off, the receiver decides.
    {
      from: 'SUBMITTED',
      action: 'approve',
      to: 'APPROVED',
      roles: ['receiver', 'admin'],
      guard: (c) => !c.approverStep,
    },
    {
      from: 'SUBMITTED',
      action: 'reject',
      to: 'REJECTED',
      roles: ['receiver', 'admin'],
      guard: (c) => !c.approverStep,
    },
    { from: 'WITH_APPROVER', action: 'approve', to: 'APPROVED', roles: ['approver', 'admin'] },
    { from: 'WITH_APPROVER', action: 'reject', to: 'REJECTED', roles: ['approver', 'admin'] },
    { from: ['APPROVED', 'REJECTED'], action: 'close', to: 'CLOSED', roles: ['raiser', 'admin', 'system'] },
    { from: OPEN_SLIP, action: 'withdraw', to: 'WITHDRAWN', roles: ['raiser', 'admin'] },
  ],
});
