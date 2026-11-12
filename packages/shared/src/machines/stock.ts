import { defineMachine } from './transition';

/**
 * Phase 13 — stock papers.
 *
 * A transfer (an indent from an outlet, an emergency outlet-to-outlet request, or a store's own transfer) is
 * asked, approved by the supplying side (in full, in part or with a substitute), dispatched (the goods are then
 * in transit, seen by both sides) and received. What arrives short, damaged or extra waits as differences for
 * an approval; the transfer closes when nothing is left to decide.
 */
export const TRANSFER_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'DISPATCHED',
  'RECEIVED',
  'CLOSED',
  'REJECTED',
  'CANCELLED',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export type TransferAction = 'approve' | 'reject' | 'dispatch' | 'receive' | 'settle' | 'cancel';
export type TransferRole = 'asker' | 'supplier' | 'receiver' | 'approver' | 'system';
/** `differences`: something arrived short, damaged or extra. */
export type TransferContext = { differences: boolean };

export const transferMachine = defineMachine<TransferStatus, TransferAction, TransferRole, TransferContext>({
  name: 'stock_transfer',
  states: TRANSFER_STATUSES,
  terminal: ['CLOSED', 'REJECTED', 'CANCELLED'],
  rules: [
    { from: 'REQUESTED', action: 'approve', to: 'APPROVED', roles: ['supplier', 'approver'] },
    { from: 'REQUESTED', action: 'reject', to: 'REJECTED', roles: ['supplier', 'approver'] },
    { from: ['REQUESTED', 'APPROVED'], action: 'cancel', to: 'CANCELLED', roles: ['asker', 'supplier'] },
    { from: 'APPROVED', action: 'dispatch', to: 'DISPATCHED', roles: ['supplier'] },
    {
      from: 'DISPATCHED',
      action: 'receive',
      to: (c) => (c.differences ? 'RECEIVED' : 'CLOSED'),
      roles: ['receiver'],
    },
    // The differences are decided: written off, or found and taken in.
    { from: 'RECEIVED', action: 'settle', to: 'CLOSED', roles: ['approver'] },
  ],
});

/** A production order: planned, then done once (consumes the recipe, makes a batch) or cancelled. */
export const PRODUCTION_STATUSES = ['PLANNED', 'DONE', 'CANCELLED'] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];
export const productionMachine = defineMachine<ProductionStatus, 'finish' | 'cancel', 'maker', object>({
  name: 'production_order',
  states: PRODUCTION_STATUSES,
  terminal: ['DONE', 'CANCELLED'],
  rules: [
    { from: 'PLANNED', action: 'finish', to: 'DONE', roles: ['maker'] },
    { from: 'PLANNED', action: 'cancel', to: 'CANCELLED', roles: ['maker'] },
  ],
});

/** A closing count of a location: counted, then submitted; a count with differences waits for an approver. */
export const CLOSING_COUNT_STATUSES = ['OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type ClosingCountStatus = (typeof CLOSING_COUNT_STATUSES)[number];
export const closingCountMachine = defineMachine<
  ClosingCountStatus,
  'submit' | 'approve' | 'reject',
  'counter' | 'approver',
  { differences: boolean }
>({
  name: 'stock_count',
  states: CLOSING_COUNT_STATUSES,
  terminal: ['APPROVED', 'REJECTED'],
  rules: [
    {
      from: 'OPEN',
      action: 'submit',
      to: (c) => (c.differences ? 'SUBMITTED' : 'APPROVED'),
      roles: ['counter'],
    },
    { from: 'SUBMITTED', action: 'approve', to: 'APPROVED', roles: ['approver'] },
    { from: 'SUBMITTED', action: 'reject', to: 'REJECTED', roles: ['approver'] },
  ],
});
