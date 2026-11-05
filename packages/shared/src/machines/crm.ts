import { defineMachine } from './transition';

/** CLAUDE.md §11 — the year plan: drafted, sent for approval, approved by the owner, unlocked to change again. */
export const PLAN_STATUSES = ['DRAFT', 'PENDING', 'APPROVED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type PlanAction = 'submit' | 'approve' | 'reject' | 'withdraw' | 'unlock';
export type PlanRole = 'editor' | 'owner';

export const planMachine = defineMachine<PlanStatus, PlanAction, PlanRole>({
  name: 'crm_plan',
  states: PLAN_STATUSES,
  rules: [
    { from: 'DRAFT', action: 'submit', to: 'PENDING', roles: ['editor', 'owner'] },
    { from: 'PENDING', action: 'approve', to: 'APPROVED', roles: ['owner'] },
    { from: 'PENDING', action: 'reject', to: 'DRAFT', roles: ['owner'] },
    { from: 'PENDING', action: 'withdraw', to: 'DRAFT', roles: ['editor', 'owner'] },
    // "Unlock this plan? Anyone with edit access can change it again. It will need approval once more."
    { from: 'APPROVED', action: 'unlock', to: 'DRAFT', roles: ['editor', 'owner'] },
  ],
});

/** A lead: an enquiry is qualified into the funnel (or not), moves through the stages, and is won or lost. */
export const LEAD_STATUSES = ['ENQUIRY', 'OPEN', 'WON', 'LOST', 'NOT_QUALIFIED'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadAction = 'qualify' | 'disqualify' | 'move' | 'win' | 'lose' | 'reopen';
export type LeadRole = 'sales';

export const leadMachine = defineMachine<LeadStatus, LeadAction, LeadRole>({
  name: 'lead',
  states: LEAD_STATUSES,
  terminal: ['WON'],
  rules: [
    { from: 'ENQUIRY', action: 'qualify', to: 'OPEN', roles: ['sales'] },
    { from: 'ENQUIRY', action: 'disqualify', to: 'NOT_QUALIFIED', roles: ['sales'] },
    { from: 'OPEN', action: 'move', to: 'OPEN', roles: ['sales'] },
    { from: 'OPEN', action: 'win', to: 'WON', roles: ['sales'] },
    { from: 'OPEN', action: 'lose', to: 'LOST', roles: ['sales'] },
    { from: ['LOST', 'NOT_QUALIFIED'], action: 'reopen', to: 'ENQUIRY', roles: ['sales'] },
  ],
});

/** A call to a customer (SCOT or win-back): answered once with a result, or cancelled (e.g. they ordered anyway). */
export const CALL_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const CALL_RESULTS = ['ORDER', 'LATER', 'NOT_NOW', 'LOST'] as const;
export type CallResult = (typeof CALL_RESULTS)[number];

export const callMachine = defineMachine<CallStatus, 'answer' | 'cancel', 'sales' | 'system'>({
  name: 'call',
  states: CALL_STATUSES,
  terminal: ['DONE', 'CANCELLED'],
  rules: [
    { from: 'OPEN', action: 'answer', to: 'DONE', roles: ['sales'] },
    { from: 'OPEN', action: 'cancel', to: 'CANCELLED', roles: ['sales', 'system'] },
  ],
});

/** A sales order: running through the after-order flow, done when it closes, or cancelled. */
export const SALES_ORDER_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const salesOrderMachine = defineMachine<SalesOrderStatus, 'finish' | 'cancel', 'sales' | 'system'>({
  name: 'sales_order',
  states: SALES_ORDER_STATUSES,
  terminal: ['DONE', 'CANCELLED'],
  rules: [
    { from: 'OPEN', action: 'finish', to: 'DONE', roles: ['system'] },
    { from: 'OPEN', action: 'cancel', to: 'CANCELLED', roles: ['sales'] },
  ],
});
