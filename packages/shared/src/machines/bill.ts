import { defineMachine } from './transition';

/**
 * Phase 12M — one bill for every kind of money paper. Papers with lines (invoice, credit / debit note, purchase
 * bill, challan) are drafted, then issued; from then on they are never edited. Money papers (receipt, advance,
 * vendor payment) are issued at once. A paper that is owed moves to part paid and paid as money is set against
 * it. An issued paper is undone only by a credit note for all of it; a money paper entered by mistake is voided
 * with a reason (and what it had settled is owed again).
 */
export const BILL_TYPES = [
  'INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'RECEIPT',
  'ADVANCE',
  'PURCHASE_BILL',
  'VENDOR_PAYMENT',
  'CHALLAN',
] as const;
export type BillType = (typeof BILL_TYPES)[number];
/** Papers that only move money: no lines, issued at once. */
export const MONEY_BILLS: readonly BillType[] = ['RECEIPT', 'ADVANCE', 'VENDOR_PAYMENT'];
/** Papers a party owes us on (or we owe them): money can be set against them. */
export const OWED_BILLS: readonly BillType[] = ['INVOICE', 'DEBIT_NOTE', 'PURCHASE_BILL'];

export const BILL_STATUSES = ['DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'CANCELLED'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillAction = 'issue' | 'settle' | 'credit' | 'discard' | 'void';
export type BillRole = 'maker' | 'accounts' | 'system';
/** `due`: what is still owed after this change. `total`: the paper's total. `money`: a money paper. */
export type BillContext = { due: number; total: number; money: boolean };

const afterMoney = (c: BillContext): BillStatus =>
  c.due <= 0 ? 'PAID' : c.due < c.total ? 'PART_PAID' : 'ISSUED';

export const billMachine = defineMachine<BillStatus, BillAction, BillRole, BillContext>({
  name: 'bill',
  states: BILL_STATUSES,
  terminal: ['CANCELLED'],
  rules: [
    { from: 'DRAFT', action: 'issue', to: 'ISSUED', roles: ['maker', 'accounts', 'system'] },
    // A draft was never a paper: it can simply be thrown away.
    { from: 'DRAFT', action: 'discard', to: 'CANCELLED', roles: ['maker', 'accounts'] },
    // Money set against it, or taken back off it (a voided receipt).
    {
      from: ['ISSUED', 'PART_PAID', 'PAID'],
      action: 'settle',
      to: afterMoney,
      roles: ['accounts', 'system'],
      guard: (c) => !c.money,
    },
    // A credit note for the whole paper cancels it; a part credit only lowers what is owed.
    {
      from: ['ISSUED', 'PART_PAID', 'PAID'],
      action: 'credit',
      to: (c) => (c.total <= 0 ? 'CANCELLED' : afterMoney(c)),
      roles: ['accounts', 'system'],
      guard: (c) => !c.money,
    },
    // A receipt or payment entered by mistake.
    { from: 'ISSUED', action: 'void', to: 'CANCELLED', roles: ['accounts'], guard: (c) => c.money },
  ],
});
