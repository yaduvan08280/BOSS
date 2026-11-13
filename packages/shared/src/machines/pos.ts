import { defineMachine } from './transition';

/**
 * Phase 15 — the POS. An order is open while items are added and fired; billing it makes its check(s); it is
 * paid when every check is settled. An order with nothing fired can simply be cancelled; once something was
 * fired its items are voided one by one (with a reason) instead.
 */
export const ORDER_STATUSES = ['OPEN', 'BILLED', 'PAID', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderAction = 'bill' | 'reopen' | 'settle' | 'cancel';
export type OrderRole = 'steward' | 'cashier' | 'manager' | 'system';
/** `fired`: something was sent to the kitchen and not voided. `allPaid`: every check is settled. */
export type OrderContext = { fired: boolean; allPaid: boolean };

export const orderMachine = defineMachine<OrderStatus, OrderAction, OrderRole, OrderContext>({
  name: 'pos_order',
  states: ORDER_STATUSES,
  terminal: ['PAID', 'CANCELLED'],
  rules: [
    {
      from: 'OPEN',
      action: 'bill',
      to: 'BILLED',
      roles: ['steward', 'cashier', 'manager'],
      guard: (c) => c.fired,
    },
    // A bill was cancelled: the table is open again.
    { from: 'BILLED', action: 'reopen', to: 'OPEN', roles: ['manager', 'system'] },
    {
      from: 'BILLED',
      action: 'settle',
      to: (c) => (c.allPaid ? 'PAID' : 'BILLED'),
      roles: ['cashier', 'manager', 'system'],
    },
    {
      from: 'OPEN',
      action: 'cancel',
      to: 'CANCELLED',
      roles: ['steward', 'cashier', 'manager'],
      guard: (c) => !c.fired,
    },
  ],
});

/** One line of an order: held until its course is fired, then made, ready, served — or voided. */
export const ITEM_STATUSES = ['HELD', 'FIRED', 'READY', 'SERVED', 'VOID'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemAction = 'fire' | 'ready' | 'serve' | 'recall' | 'void';
export const orderItemMachine = defineMachine<
  ItemStatus,
  ItemAction,
  'steward' | 'kitchen' | 'manager',
  object
>({
  name: 'pos_order_item',
  states: ITEM_STATUSES,
  terminal: ['VOID'],
  rules: [
    { from: 'HELD', action: 'fire', to: 'FIRED', roles: ['steward', 'manager'] },
    { from: 'FIRED', action: 'ready', to: 'READY', roles: ['kitchen', 'manager'] },
    { from: 'READY', action: 'recall', to: 'FIRED', roles: ['kitchen', 'manager'] },
    { from: ['FIRED', 'READY'], action: 'serve', to: 'SERVED', roles: ['steward', 'kitchen', 'manager'] },
    { from: ['HELD', 'FIRED', 'READY', 'SERVED'], action: 'void', to: 'VOID', roles: ['steward', 'manager'] },
  ],
});

/** A kitchen ticket at a station: new, being made, ready, bumped off the display (and recalled if needed). */
export const KOT_STATUSES = ['NEW', 'READY', 'BUMPED', 'CANCELLED'] as const;
export type KotStatus = (typeof KOT_STATUSES)[number];
export type KotAction = 'ready' | 'bump' | 'recall' | 'cancel';
export const kotMachine = defineMachine<KotStatus, KotAction, 'kitchen' | 'manager' | 'system', object>({
  name: 'kot',
  states: KOT_STATUSES,
  terminal: ['CANCELLED'],
  rules: [
    { from: 'NEW', action: 'ready', to: 'READY', roles: ['kitchen', 'manager'] },
    { from: ['NEW', 'READY'], action: 'bump', to: 'BUMPED', roles: ['kitchen', 'manager'] },
    { from: ['BUMPED', 'READY'], action: 'recall', to: 'NEW', roles: ['kitchen', 'manager'] },
    // Every item on it was voided.
    { from: ['NEW', 'READY'], action: 'cancel', to: 'CANCELLED', roles: ['system', 'manager'] },
  ],
});

/** A check (one bill of an order): open until paid; cancelled only with an approval and a reason. */
export const CHECK_STATUSES = ['OPEN', 'PAID', 'CANCELLED'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export const checkMachine = defineMachine<
  CheckStatus,
  'settle' | 'cancel',
  'cashier' | 'approver' | 'system',
  { due: number }
>({
  name: 'pos_check',
  states: CHECK_STATUSES,
  // A paid check is not final: it can still be cancelled, with an approval and a reason.
  terminal: ['CANCELLED'],
  rules: [
    {
      from: 'OPEN',
      action: 'settle',
      to: (c) => (c.due <= 0 ? 'PAID' : 'OPEN'),
      roles: ['cashier', 'system'],
    },
    { from: ['OPEN', 'PAID'], action: 'cancel', to: 'CANCELLED', roles: ['approver'] },
  ],
});
