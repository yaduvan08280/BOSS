import { banquetMachine } from '../machines/banquet';
import { billMachine } from '../machines/bill';
import { callMachine, leadMachine, planMachine, salesOrderMachine } from '../machines/crm';
import { hkTaskMachine, roomHkMachine, stayMachine } from '../machines/hotel';
import { buddyMachine, coverMachine, leaveMachine } from '../machines/hr';
import { adjustMachine, countMachine, poMachine } from '../machines/ims';
import { checkMachine, kotMachine, orderItemMachine, orderMachine } from '../machines/pos';
import { reservationMachine, waitlistMachine } from '../machines/reservation';
import { closingCountMachine, productionMachine, transferMachine } from '../machines/stock';
import type { Machine } from '../machines/transition';
import { machineGraph, type FlowGraph, type FlowNode, type GraphOptions, type ProcessLink } from './graph';
import { ENGINE_MODULES, engineGraph, type EngineModule } from './modules';

/**
 * Every process MONO runs, drawn in the Business Engine (decision 238). Each chart comes from the same state machine
 * the API runs (`transition()`), so it can never drift from what the app really does: a new rule in a machine is a
 * new box on its chart. `links` say where a process hands over to another (a booking seated opens a POS order, a
 * paid bill on a room goes to the guest's folio …); they are drawn as boxes that open the other process, and
 * together they make the system map.
 */
export const PROCESS_GROUPS = [
  'work',
  'hr',
  'sales',
  'stock',
  'money',
  'restaurant',
  'hotel',
  'events',
] as const;
export type ProcessGroup = (typeof PROCESS_GROUPS)[number];

type AnyMachine = Machine<string, string, string, never>;
type Def = {
  key: string;
  group: ProcessGroup;
  /** The screen where the work is done. */
  screen: string;
  /** The hospitality module must be switched on. */
  hosp?: boolean;
  links?: ProcessLink[];
  /**
   * Where the company's own rules for this process change its paths (decision 239): from those rules (the ones its
   * "Set up" panel edits), the situations to draw and the hand-overs that still happen.
   */
  follows?: (rules: Record<string, unknown>) => { also?: unknown[]; links?: ProcessLink[] };
} & (
  | { engine: EngineModule }
  | {
      machine: AnyMachine;
      /** The usual situation, then other situations whose paths should be drawn too (see `also`). */
      ctx: unknown;
      opts: Omit<GraphOptions<string>, 'links'>;
    }
);

const m = (x: unknown) => x as AnyMachine;

export const PROCESSES: readonly Def[] = [
  // Business Engine: their charts follow the company's own settings.
  { key: 'delegation', group: 'work', screen: '/delegation', engine: 'delegation' },
  { key: 'checklist', group: 'work', screen: '/checklists', engine: 'checklist' },
  {
    key: 'slip',
    group: 'work',
    screen: '/help-slips',
    engine: 'slip',
    links: [{ from: 'APPROVED', to: 'delegation', key: 'makesTask' }],
  },
  { key: 'ticket', group: 'work', screen: '/help-tickets', engine: 'ticket' },
  {
    key: 'ea',
    group: 'work',
    screen: '/ea',
    engine: 'ea',
    links: [{ from: 'delegate', to: 'delegation', key: 'makesTask' }],
  },

  // HR
  {
    key: 'leave',
    group: 'hr',
    screen: '/hr/leave',
    machine: m(leaveMachine),
    ctx: { started: false },
    opts: {
      start: { key: 'requestLeave', to: 'PENDING' },
      finished: ['APPROVED'],
      deadEnds: ['REJECTED', 'CANCELLED'],
    },
    links: [
      { from: 'PENDING', to: 'buddy', key: 'asksBuddy' },
      { from: 'APPROVED', to: 'cover', key: 'workMoves' },
    ],
    // "Leave without a Buddy: allowed, nobody asked" — no Buddy is asked.
    follows: (r) =>
      (r.buddy as { noBuddy?: string } | undefined)?.noBuddy === 'off'
        ? { links: [{ from: 'APPROVED', to: 'cover', key: 'workMoves' }] }
        : {},
  },
  {
    key: 'buddy',
    group: 'hr',
    screen: '/hr/cover',
    machine: m(buddyMachine),
    ctx: {},
    opts: {
      start: { key: 'askBuddy', to: 'ASKED' },
      finished: ['ACCEPTED'],
      deadEnds: ['DECLINED', 'EXPIRED', 'CANCELLED'],
    },
    links: [{ from: 'ACCEPTED', to: 'cover', key: 'workMoves' }],
  },
  {
    key: 'cover',
    group: 'hr',
    screen: '/hr/cover',
    machine: m(coverMachine),
    ctx: {},
    opts: {
      start: { key: 'arrangeCover', to: 'SCHEDULED' },
      finished: ['RETURNED', 'KEPT'],
      deadEnds: ['CANCELLED'],
    },
    links: [
      { from: 'ACTIVE', to: 'delegation', key: 'coveredWork' },
      { from: 'ACTIVE', to: 'checklist', key: 'coveredWork' },
    ],
  },

  // Sales CRM
  {
    key: 'crm_plan',
    group: 'sales',
    screen: '/crm/setup',
    machine: m(planMachine),
    ctx: {},
    opts: { start: { key: 'draftPlan', to: 'DRAFT' }, finished: ['APPROVED'] },
  },
  {
    key: 'lead',
    group: 'sales',
    screen: '/crm/nbd',
    machine: m(leadMachine),
    ctx: {},
    opts: {
      start: { key: 'enquiry', to: 'ENQUIRY' },
      finished: ['WON'],
      deadEnds: ['LOST', 'NOT_QUALIFIED'],
    },
    links: [{ from: 'WON', to: 'sales_order', key: 'firstOrder' }],
  },
  {
    key: 'call',
    group: 'sales',
    screen: '/crm/calls',
    machine: m(callMachine),
    ctx: {},
    opts: { start: { key: 'callDue', to: 'OPEN' }, finished: ['DONE'], deadEnds: ['CANCELLED'] },
    links: [{ from: 'answer', to: 'sales_order', key: 'orderTaken' }],
  },
  {
    key: 'sales_order',
    group: 'sales',
    screen: '/crm/orders',
    machine: m(salesOrderMachine),
    ctx: {},
    opts: { start: { key: 'takeOrder', to: 'OPEN' }, finished: ['DONE'], deadEnds: ['CANCELLED'] },
    links: [{ from: 'OPEN', to: 'bill', key: 'invoice' }],
  },

  // Stock
  {
    key: 'purchase_order',
    group: 'stock',
    screen: '/ims/purchase',
    machine: m(poMachine),
    ctx: { allIn: true, anyIn: false },
    opts: {
      start: { key: 'raisePo', to: 'DRAFT' },
      finished: ['RECEIVED'],
      deadEnds: ['CANCELLED'],
      also: [{ allIn: false, anyIn: true }],
    },
    links: [{ from: 'receive', to: 'bill', key: 'purchaseBill' }],
  },
  {
    key: 'stock_transfer',
    group: 'stock',
    screen: '/ims/transfers',
    machine: m(transferMachine),
    ctx: { differences: false },
    opts: {
      start: { key: 'askStock', to: 'REQUESTED' },
      finished: ['CLOSED'],
      deadEnds: ['REJECTED', 'CANCELLED'],
      also: [{ differences: true }],
    },
    links: [{ from: 'dispatch', to: 'bill', key: 'challanOrInvoice' }],
  },
  {
    key: 'production_order',
    group: 'stock',
    screen: '/ims/kitchen',
    machine: m(productionMachine),
    ctx: {},
    opts: { start: { key: 'planProduction', to: 'PLANNED' }, finished: ['DONE'], deadEnds: ['CANCELLED'] },
  },
  {
    key: 'stock_adjustment',
    group: 'stock',
    screen: '/ims/stock',
    machine: m(adjustMachine),
    ctx: { own: false, neverOwn: true },
    opts: { start: { key: 'reportLoss', to: 'PENDING' }, finished: ['APPLIED'], deadEnds: ['REJECTED'] },
  },
  {
    key: 'stock_count',
    group: 'stock',
    screen: '/ims/counts',
    machine: m(closingCountMachine),
    ctx: { differences: true },
    opts: {
      start: { key: 'openCount', to: 'OPEN' },
      finished: ['APPROVED'],
      deadEnds: ['REJECTED'],
      also: [{ differences: false }],
    },
  },
  {
    key: 'audit_count',
    group: 'stock',
    screen: '/ims/audit',
    machine: m(countMachine),
    ctx: {},
    opts: { start: { key: 'auditCycle', to: 'OPEN' }, finished: ['COUNTED'], deadEnds: ['SKIPPED'] },
    links: [{ from: 'COUNTED', to: 'stock_adjustment', key: 'differenceWaits' }],
  },

  // Money
  {
    key: 'bill',
    group: 'money',
    screen: '/money/bills',
    machine: m(billMachine),
    ctx: { due: 0, total: 100, money: false },
    opts: {
      start: { key: 'makeBill', to: 'DRAFT' },
      finished: ['PAID'],
      deadEnds: ['CANCELLED'],
      also: [
        { due: 40, total: 100, money: false },
        { due: 100, total: 100, money: false },
        { due: 0, total: 0, money: false },
        { due: 0, total: 100, money: true },
      ],
    },
  },

  // Restaurant
  {
    key: 'reservation',
    group: 'restaurant',
    screen: '/hosp/reservations',
    hosp: true,
    machine: m(reservationMachine),
    ctx: { depositDue: false, pastHold: true },
    opts: {
      start: { key: 'book', to: 'REQUESTED' },
      finished: ['FINISHED'],
      deadEnds: ['CANCELLED', 'NO_SHOW'],
      also: [{ depositDue: true, pastHold: false }],
    },
    links: [
      { from: 'REQUESTED', to: 'bill', key: 'deposit' },
      { from: 'seat', to: 'pos_order', key: 'opensOrder' },
    ],
    // An outlet that takes no deposits never sends a booking to Money for one.
    follows: (r) =>
      Number(r.depositFrom ?? 0) > 0 ? {} : { links: [{ from: 'seat', to: 'pos_order', key: 'opensOrder' }] },
  },
  {
    key: 'waitlist',
    group: 'restaurant',
    screen: '/hosp/reservations',
    hosp: true,
    machine: m(waitlistMachine),
    ctx: {},
    opts: { start: { key: 'addToWaitlist', to: 'WAITING' }, finished: ['SEATED'], deadEnds: ['LEFT'] },
    links: [{ from: 'SEATED', to: 'pos_order', key: 'opensOrder' }],
  },
  {
    key: 'pos_order',
    group: 'restaurant',
    screen: '/hosp/pos',
    hosp: true,
    machine: m(orderMachine),
    ctx: { fired: true, allPaid: true },
    opts: {
      start: { key: 'openTable', to: 'OPEN' },
      finished: ['PAID'],
      deadEnds: ['CANCELLED'],
      also: [{ fired: false, allPaid: false }],
    },
    links: [
      { from: 'OPEN', to: 'pos_order_item', key: 'addsItems' },
      { from: 'bill', to: 'pos_check', key: 'makesBill' },
      { from: 'PAID', to: 'reservation', key: 'finishesBooking' },
    ],
  },
  {
    key: 'pos_order_item',
    group: 'restaurant',
    screen: '/hosp/pos',
    hosp: true,
    machine: m(orderItemMachine),
    ctx: {},
    opts: { start: { key: 'addItem', to: 'HELD' }, finished: ['SERVED'], deadEnds: ['VOID'] },
    links: [{ from: 'fire', to: 'kot', key: 'kitchenTicket' }],
  },
  {
    key: 'kot',
    group: 'restaurant',
    screen: '/hosp/kds',
    hosp: true,
    machine: m(kotMachine),
    ctx: {},
    opts: { start: { key: 'fireItems', to: 'NEW' }, finished: ['BUMPED'], deadEnds: ['CANCELLED'] },
  },
  {
    key: 'pos_check',
    group: 'restaurant',
    screen: '/hosp/pos',
    hosp: true,
    machine: m(checkMachine),
    ctx: { due: 0 },
    opts: {
      start: { key: 'printBill', to: 'OPEN' },
      finished: ['PAID'],
      deadEnds: ['CANCELLED'],
      also: [{ due: 100 }],
    },
    links: [
      { from: 'OPEN', to: 'bill', key: 'invoice' },
      { from: 'settle', to: 'stay', key: 'roomCharge' },
    ],
  },

  // Hotel
  {
    key: 'stay',
    group: 'hotel',
    screen: '/hotel/desk',
    hosp: true,
    machine: m(stayMachine),
    ctx: { room: true, kyc: true, settled: true },
    opts: {
      start: { key: 'bookRoom', to: 'BOOKED' },
      finished: ['CHECKED_OUT'],
      deadEnds: ['CANCELLED', 'NO_SHOW'],
    },
    links: [
      { from: 'BOOKED', to: 'bill', key: 'advance' },
      { from: 'CHECKED_IN', to: 'ticket', key: 'guestRequest' },
      { from: 'checkOut', to: 'bill', key: 'folioInvoice' },
      { from: 'checkOut', to: 'room_hk', key: 'roomDirty' },
    ],
  },
  {
    key: 'room_hk',
    group: 'hotel',
    screen: '/hotel/housekeeping',
    hosp: true,
    machine: m(roomHkMachine),
    ctx: { service: false },
    opts: {
      start: { key: 'guestLeaves', to: 'DIRTY' },
      finished: ['INSPECTED'],
      deadEnds: ['OUT_OF_ORDER', 'OUT_OF_SERVICE'],
      also: [{ service: true }],
    },
    links: [
      { from: 'DIRTY', to: 'hk_task', key: 'cleaningTask' },
      { from: 'block', to: 'ticket', key: 'repairTicket' },
    ],
  },
  {
    key: 'hk_task',
    group: 'hotel',
    screen: '/hotel/housekeeping',
    hosp: true,
    machine: m(hkTaskMachine),
    ctx: { ticked: true },
    opts: { start: { key: 'layOutCleaning', to: 'OPEN' }, finished: ['INSPECTED'] },
    links: [{ from: 'inspect', to: 'room_hk', key: 'roomReady' }],
  },

  // Banquets and events
  {
    key: 'banquet',
    group: 'events',
    screen: '/hosp/banquets',
    hosp: true,
    machine: m(banquetMachine),
    ctx: { advancePaid: true, checked: true, settled: true },
    opts: { start: { key: 'enquiry', to: 'ENQUIRY' }, finished: ['CLOSED'], deadEnds: ['LOST', 'CANCELLED'] },
    links: [
      { from: 'QUOTED', to: 'bill', key: 'advance' },
      { from: 'complete', to: 'bill', key: 'finalInvoice' },
    ],
  },
];

export type ProcessKey = string;
export const processDef = (key: string) => PROCESSES.find((p) => p.key === key);

/** The chart of one process under the company's rules (an engine module's settings, or its "Set up" rules). */
export function processGraph(key: string, settings?: unknown): FlowGraph | null {
  const d = processDef(key);
  if (!d) return null;
  if ('engine' in d) return engineGraph(d.engine, settings, d.links);
  const f = settings && d.follows ? d.follows(settings as Record<string, unknown>) : {};
  return machineGraph(d.machine, d.ctx as never, {
    ...d.opts,
    ...(f.also ? { also: f.also } : {}),
    links: f.links ?? d.links,
  });
}

/** Processes that lead into this one (the other half of "how it connects"). */
export const processesInto = (key: string) =>
  PROCESSES.flatMap((p) =>
    (p.links ?? []).filter((l) => l.to === key).map((l) => ({ from: p.key, key: l.key })),
  );

/** The whole system on one chart: every process as a box, an arrow for each hand-over. */
export function systemMap(withHosp: boolean): FlowGraph {
  const shown = PROCESSES.filter((p) => withHosp || !p.hosp);
  const keys = new Set(shown.map((p) => p.key));
  const nodes: FlowNode[] = shown.map((p) => ({
    id: p.key,
    kind: 'link',
    key: p.key,
    roles: [],
    off: false,
    target: p.key,
  }));
  const seen = new Set<string>();
  const edges = shown.flatMap((p) =>
    (p.links ?? [])
      .filter((l) => keys.has(l.to) && l.to !== p.key)
      .flatMap((l) => {
        const id = `${p.key}->${l.to}`;
        if (seen.has(id)) return [];
        seen.add(id);
        return [{ id, source: p.key, target: l.to, off: false }];
      }),
  );
  return { nodes, edges };
}

/** Engine modules are a subset of the processes (their settings live in the flow designer). */
export const isEngineProcess = (key: string): key is EngineModule =>
  (ENGINE_MODULES as readonly string[]).includes(key);
