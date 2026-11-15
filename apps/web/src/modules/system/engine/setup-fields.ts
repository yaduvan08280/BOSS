/** What each process's "Set up" panel shows (decision 239); where it is saved is in `setup.ts`. */
export type SourceId = 'hr' | 'ims' | 'crm' | 'hosp' | 'hotel' | 'branch' | 'booking';
/** Rules kept per hotel property, per branch, or per restaurant outlet. */
export type ScopeKind = 'property' | 'branch' | 'outlet';
type Rules = Record<string, unknown>;

export type SetupField =
  | { path: string; kind: 'toggle' | 'person' | 'people' | 'time' | 'money' | 'lines' | 'stageDays' }
  | {
      path: string;
      kind: 'number';
      unit: 'min' | 'hours' | 'days' | 'pct' | 'people' | 'items';
      max: number;
      min?: number;
    }
  | { path: string; kind: 'select'; options: readonly (string | number)[] };

export const getAt = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Rules)[k] : undefined), o);
export function setAt(o: Rules, path: string, v: unknown): Rules {
  const [k, ...rest] = path.split('.');
  if (!rest.length) return { ...o, [k!]: v };
  return { ...o, [k!]: setAt((o[k!] as Rules | undefined) ?? {}, rest.join('.'), v) };
}

export type ProcessSetupDef = { src: SourceId; fields: SetupField[] };

const days = (path: string, max = 365, min = 1): SetupField => ({
  path,
  kind: 'number',
  unit: 'days',
  max,
  min,
});
const hours = (path: string, max = 72, min = 1): SetupField => ({
  path,
  kind: 'number',
  unit: 'hours',
  max,
  min,
});
const mins = (path: string, max = 240, min = 0): SetupField => ({
  path,
  kind: 'number',
  unit: 'min',
  max,
  min,
});
const pct = (path: string): SetupField => ({ path, kind: 'number', unit: 'pct', max: 100, min: 0 });
const on = (path: string): SetupField => ({ path, kind: 'toggle' });
const people = (path: string): SetupField => ({ path, kind: 'people' });
const person = (path: string): SetupField => ({ path, kind: 'person' });

/** Per process: the rules that change it. Processes left out have nothing of their own to set. */
export const PROCESS_SETUP: Record<string, ProcessSetupDef> = {
  leave: {
    src: 'hr',
    fields: [
      person('leave.hrUserId'),
      on('autopilot.autoApproveShort'),
      { path: 'buddy.noBuddy', kind: 'select', options: ['block', 'warn', 'off'] },
      { path: 'buddy.needsBuddy', kind: 'select', options: ['any', 'fullDay', 'days'] },
      days('buddy.needsBuddyDays', 30),
      days('leave.compOffValidDays'),
    ],
  },
  buddy: {
    src: 'hr',
    fields: [
      hours('buddyAnswer.answerHours'),
      on('autopilot.autoPick'),
      on('buddy.otherDepartment'),
      on('buddy.otherBranch'),
      { path: 'buddy.maxCover', kind: 'number', unit: 'people', max: 10, min: 1 },
    ],
  },
  cover: {
    src: 'hr',
    fields: [
      { path: 'buddyAnswer.onReturn', kind: 'select', options: ['notStarted', 'all', 'keep'] },
      on('autopilot.absentToBuddy'),
      hours('buddyAnswer.absentConfirmHours', 24),
    ],
  },
  crm_plan: { src: 'crm', fields: [pct('split.crrPct'), on('split.gpFollows')] },
  lead: {
    src: 'crm',
    fields: [people('seats.nbdSc'), people('seats.salesRep'), { path: 'nbd.stages', kind: 'stageDays' }],
  },
  call: {
    src: 'crm',
    fields: [
      people('seats.crrSc'),
      people('seats.osr'),
      days('customers.sleepingDays', 730, 7),
      days('customers.lostDays', 1095, 14),
    ],
  },
  sales_order: {
    src: 'crm',
    fields: [
      people('seats.crm'),
      { path: 'customers.newOrders', kind: 'number', unit: 'items', max: 50, min: 1 },
      days('customers.newDays', 730),
    ],
  },
  purchase_order: {
    src: 'ims',
    fields: [
      people('people.purchaseIds'),
      people('people.storeKeeperIds'),
      { path: 'ows.orderWeekday', kind: 'select', options: [1, 2, 3, 4, 5, 6, 7] },
      days('ows.daysAhead', 6, 0),
    ],
  },
  stock_transfer: {
    src: 'ims',
    fields: [
      { path: 'stock.emergencyApprovals', kind: 'select', options: ['one', 'both'] },
      people('people.storeKeeperIds'),
    ],
  },
  production_order: {
    src: 'ims',
    fields: [
      { path: 'stock.valuation', kind: 'select', options: ['AVG', 'FIFO'] },
      days('stock.expiryAlertDays', 365, 0),
    ],
  },
  stock_adjustment: {
    src: 'ims',
    fields: [
      { path: 'stock.wasteApproveOverPaise', kind: 'money' },
      people('people.approverIds'),
      on('people.anyOne'),
      on('people.neverOwn'),
      on('people.ownerAlways'),
    ],
  },
  stock_count: { src: 'ims', fields: [pct('stock.varianceFlagPct'), people('people.reviewerIds')] },
  audit_count: {
    src: 'ims',
    fields: [
      { path: 'audit.topByValue', kind: 'number', unit: 'items', max: 1000, min: 1 },
      days('audit.cycleDays', 365, 7),
      days('audit.deadAfterDays', 1095, 30),
      people('people.auditIds'),
    ],
  },
  reservation: {
    src: 'booking',
    fields: [
      on('autoConfirm'),
      { path: 'depositFrom', kind: 'number', unit: 'people', max: 500, min: 0 },
      { path: 'depositPerHeadPaise', kind: 'money' },
      mins('holdMin'),
      hours('reminderHours', 72, 0),
      hours('cancelFreeHours', 240, 0),
      { path: 'noShowDeposit', kind: 'select', options: ['KEEP', 'REFUND'] },
    ],
  },
  pos_order: { src: 'hosp', fields: [people('approverIds'), { path: 'ncReasons', kind: 'lines' }] },
  pos_check: {
    src: 'hosp',
    fields: [
      { path: 'dayClose.cutoffMin', kind: 'time' },
      on('dayClose.blindCash'),
      people('dayClose.closerIds'),
    ],
  },
  stay: {
    src: 'hotel',
    fields: [
      { path: 'checkInMin', kind: 'time' },
      { path: 'checkOutMin', kind: 'time' },
      mins('graceMin'),
      pct('earlyFeePct'),
      pct('lateFeePct'),
      { path: 'lateFullMin', kind: 'time' },
      hours('formCHours'),
      person('requestSolverId'),
      mins('requestSlaMin', 1440, 5),
    ],
  },
  room_hk: { src: 'hotel', fields: [person('maintenanceSolverId')] },
  hk_task: { src: 'hotel', fields: [{ path: 'hkChecklist', kind: 'lines' }] },
  banquet: { src: 'branch', fields: [pct('banquet.advancePct'), days('banquet.cancelFreeDays', 365, 0)] },
};

/** Processes with nothing of their own to set, and the screen that shapes them instead. */
export const SETUP_ELSEWHERE: Record<string, string> = {
  waitlist: '/hosp/reservations',
  pos_order_item: '/system/hospitality',
  kot: '/system/hospitality',
  bill: '/money/setup',
};

/** The label key of a field: `flows.f.<source>_<path with _>`. */
export const fieldKey = (src: SourceId, path: string) => `${src}_${path.replaceAll('.', '_')}`;
