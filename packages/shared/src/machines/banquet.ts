import { defineMachine } from './transition';

/**
 * Phase 18 — a banquet event: an enquiry is quoted, confirmed once its advance is in (the hall is then held),
 * held on its day (its checklist done), billed on the covers that came, and closed when the bill is settled.
 * An enquiry can be lost; a confirmed event cancelled.
 */
export const BANQUET_STATUSES = [
  'ENQUIRY',
  'QUOTED',
  'CONFIRMED',
  'COMPLETED',
  'CLOSED',
  'LOST',
  'CANCELLED',
] as const;
export type BanquetStatus = (typeof BANQUET_STATUSES)[number];
export type BanquetAction = 'quote' | 'confirm' | 'revise' | 'complete' | 'close' | 'lose' | 'cancel';
export type BanquetRole = 'sales' | 'manager' | 'system';
/** `advancePaid`: the advance the rules ask is in. `checked`: the event-day checklist is done. `settled`: the bill is paid or on credit. */
export type BanquetContext = { advancePaid: boolean; checked: boolean; settled: boolean };

/** Statuses that hold a hall: nobody else can be confirmed there for that time. */
export const HALL_HOLDING: readonly BanquetStatus[] = ['CONFIRMED', 'COMPLETED'];

export const banquetMachine = defineMachine<BanquetStatus, BanquetAction, BanquetRole, BanquetContext>({
  name: 'banquet',
  states: BANQUET_STATUSES,
  terminal: ['CLOSED', 'LOST', 'CANCELLED'],
  rules: [
    { from: ['ENQUIRY', 'QUOTED'], action: 'quote', to: 'QUOTED', roles: ['sales', 'manager'] },
    {
      from: 'QUOTED',
      action: 'confirm',
      to: 'CONFIRMED',
      roles: ['sales', 'manager'],
      guard: (c) => c.advancePaid,
    },
    // A change after confirmation (covers, menu, extras) keeps it confirmed and makes a new BEO.
    { from: 'CONFIRMED', action: 'revise', to: 'CONFIRMED', roles: ['sales', 'manager'] },
    {
      from: 'CONFIRMED',
      action: 'complete',
      to: 'COMPLETED',
      roles: ['sales', 'manager'],
      guard: (c) => c.checked,
    },
    {
      from: 'COMPLETED',
      action: 'close',
      to: 'CLOSED',
      roles: ['sales', 'manager', 'system'],
      guard: (c) => c.settled,
    },
    { from: ['ENQUIRY', 'QUOTED'], action: 'lose', to: 'LOST', roles: ['sales', 'manager'] },
    { from: 'CONFIRMED', action: 'cancel', to: 'CANCELLED', roles: ['manager'] },
  ],
});
