import { defineMachine } from './transition';

/** CLAUDE.md §10 — a purchase order: drafted (often from the OWS list), sent, received in parts or whole. */
export const PO_STATUSES = ['DRAFT', 'SENT', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export type PoAction = 'send' | 'receive' | 'close' | 'cancel';
export type PoRole = 'purchase' | 'store' | 'admin';
/** `allIn`: after this receipt every line is fully received. `anyIn`: something was received already. */
export type PoContext = { allIn: boolean; anyIn: boolean };

export const poMachine = defineMachine<PoStatus, PoAction, PoRole, PoContext>({
  name: 'purchase_order',
  states: PO_STATUSES,
  terminal: ['RECEIVED', 'CANCELLED'],
  rules: [
    { from: 'DRAFT', action: 'send', to: 'SENT', roles: ['purchase', 'admin'] },
    {
      from: ['SENT', 'PARTLY_RECEIVED'],
      action: 'receive',
      to: (c) => (c.allIn ? 'RECEIVED' : 'PARTLY_RECEIVED'),
      roles: ['store', 'purchase', 'admin'],
    },
    // A part-received order the vendor won't complete is closed short.
    { from: 'PARTLY_RECEIVED', action: 'close', to: 'RECEIVED', roles: ['purchase', 'admin'] },
    {
      from: ['DRAFT', 'SENT'],
      action: 'cancel',
      to: 'CANCELLED',
      roles: ['purchase', 'admin'],
      guard: (c) => !c.anyIn,
    },
  ],
});

/**
 * A stock adjustment (damaged, expired, lost, found, counted) waits for an approver before it changes stock.
 * So does a line an FMS step could not issue (phase 11) and a reversal that could not be applied.
 */
export const ADJUST_STATUSES = ['PENDING', 'APPLIED', 'REJECTED'] as const;
export type AdjustStatus = (typeof ADJUST_STATUSES)[number];
export type AdjustAction = 'approve' | 'reject' | 'withdraw';
export type AdjustRole = 'approver' | 'system';
/** `own`: the approver made the adjustment; `neverOwn`: the rule forbids approving your own. */
export type AdjustContext = { own: boolean; neverOwn: boolean };

export const adjustMachine = defineMachine<AdjustStatus, AdjustAction, AdjustRole, AdjustContext>({
  name: 'stock_adjustment',
  states: ADJUST_STATUSES,
  terminal: ['APPLIED', 'REJECTED'],
  rules: [
    {
      from: 'PENDING',
      action: 'approve',
      to: 'APPLIED',
      roles: ['approver'],
      guard: (c) => !(c.own && c.neverOwn),
    },
    {
      from: 'PENDING',
      action: 'reject',
      to: 'REJECTED',
      roles: ['approver'],
      guard: (c) => !(c.own && c.neverOwn),
    },
    // A line an FMS step left waiting (not enough stock) is dropped when that step is undone or its record
    // cancelled: nobody decides it any more.
    { from: 'PENDING', action: 'withdraw', to: 'REJECTED', roles: ['system'] },
  ],
});

/** An audit count: opened for the cycle, counted (a difference becomes an adjustment to approve), or skipped. */
export const COUNT_STATUSES = ['OPEN', 'COUNTED', 'SKIPPED'] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];
export type CountAction = 'count' | 'skip';
export type CountRole = 'auditor' | 'system';

export const countMachine = defineMachine<CountStatus, CountAction, CountRole>({
  name: 'audit_count',
  states: COUNT_STATUSES,
  terminal: ['COUNTED', 'SKIPPED'],
  rules: [
    { from: 'OPEN', action: 'count', to: 'COUNTED', roles: ['auditor'] },
    { from: 'OPEN', action: 'skip', to: 'SKIPPED', roles: ['auditor', 'system'] },
  ],
});
