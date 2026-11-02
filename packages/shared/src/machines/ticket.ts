import { defineMachine } from './transition';

/**
 * CLAUDE.md §5.4: issue → fix. Escalation is a level on the ticket (0/1/2), not a status,
 * so the solver can keep working on an escalated ticket.
 */
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_ACTIONS = [
  'reply',
  'resolve',
  'confirm',
  'reopen',
  'autoClose',
  'comment',
  'movePlan',
  'reassign',
  'cancel',
] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];
export type TicketRole = 'raiser' | 'solver' | 'coordinator' | 'admin' | 'system' | 'any';
export type TicketContext = { autoClose: boolean };

const LIVE = ['OPEN', 'IN_PROGRESS'] as const;
/** Actions that leave the status as it is. */
export const TICKET_KEEP: TicketAction[] = ['comment', 'movePlan'];

export const ticketMachine = defineMachine<TicketStatus, TicketAction, TicketRole, TicketContext>({
  name: 'ticket',
  states: TICKET_STATUSES,
  terminal: ['CLOSED', 'CANCELLED'],
  rules: [
    { from: LIVE, action: 'reply', to: 'IN_PROGRESS', roles: ['solver', 'admin'] },
    { from: LIVE, action: 'resolve', to: 'RESOLVED', roles: ['solver', 'admin'] },
    { from: 'RESOLVED', action: 'confirm', to: 'CLOSED', roles: ['raiser', 'admin'] },
    { from: 'RESOLVED', action: 'reopen', to: 'IN_PROGRESS', roles: ['raiser', 'admin'] },
    { from: 'RESOLVED', action: 'autoClose', to: 'CLOSED', roles: ['system'], guard: (c) => c.autoClose },
    {
      from: [...LIVE, 'RESOLVED'],
      action: 'comment',
      to: 'OPEN',
      roles: ['raiser', 'solver', 'coordinator', 'admin'],
    },
    { from: LIVE, action: 'movePlan', to: 'OPEN', roles: ['raiser', 'solver', 'coordinator', 'admin'] },
    { from: LIVE, action: 'reassign', to: 'OPEN', roles: ['raiser', 'coordinator', 'admin'] },
    { from: [...LIVE, 'RESOLVED'], action: 'cancel', to: 'CANCELLED', roles: ['raiser', 'admin'] },
  ],
});
