import { z } from 'zod';

/**
 * "Ask" (CLAUDE.md §13): the AI never writes SQL. It picks one of these read-only views and fills in a
 * plan (columns, filters, grouping); MONO checks every name against this list and binds every value.
 */
export type AskColumnType = 'text' | 'number' | 'date' | 'bool';
export type AskView = {
  label: string;
  about: string;
  columns: Record<string, { type: AskColumnType; about: string }>;
  /** Shown when the question doesn't say which columns. */
  defaults: string[];
};

export const ASK_VIEWS = {
  tasks: {
    label: 'Delegation tasks',
    about: 'One-time tasks given to a person (Delegation sheet).',
    columns: {
      number: { type: 'number', about: 'task number' },
      task: { type: 'text', about: 'what the task is' },
      doer: { type: 'text', about: 'who does it' },
      given_by: { type: 'text', about: 'who gave it' },
      department: { type: 'text', about: "the doer's department" },
      status: {
        type: 'text',
        about: 'AWAITING_ACCEPTANCE, OPEN, PENDING_VERIFY, DONE, RETURNED_TO_CREATOR or CANCELLED',
      },
      planned_at: { type: 'date', about: 'when it is due' },
      done_at: { type: 'date', about: 'when it was marked done' },
      is_late: { type: 'bool', about: 'still open and past its due time' },
      days_late: { type: 'number', about: 'whole days past the due time (0 when on time)' },
      date_moves: { type: 'number', about: 'how often the due date was moved' },
      created_at: { type: 'date', about: 'when it was given' },
    },
    defaults: ['number', 'task', 'doer', 'status', 'planned_at'],
  },
  checklists: {
    label: 'Checklist runs',
    about: 'Each time a recurring checklist is due for a person.',
    columns: {
      checklist: { type: 'text', about: 'checklist name' },
      doer: { type: 'text', about: 'who does it' },
      department: { type: 'text', about: 'department' },
      status: { type: 'text', about: 'OPEN, PENDING_VERIFY, DONE or MISSED' },
      planned_at: { type: 'date', about: 'when it was due' },
      submitted_at: { type: 'date', about: 'when it was submitted' },
      items_done: { type: 'number', about: 'items ticked' },
      items_total: { type: 'number', about: 'items in the checklist' },
      is_missed: { type: 'bool', about: 'closed without being done' },
    },
    defaults: ['checklist', 'doer', 'status', 'planned_at'],
  },
  tickets: {
    label: 'Help tickets',
    about: 'Issues raised for someone to fix.',
    columns: {
      number: { type: 'number', about: 'ticket number' },
      title: { type: 'text', about: 'the issue' },
      raised_by: { type: 'text', about: 'who raised it' },
      solver: { type: 'text', about: 'who fixes it' },
      department: { type: 'text', about: 'department' },
      status: { type: 'text', about: 'OPEN, IN_PROGRESS, RESOLVED, CLOSED or CANCELLED' },
      escalation_level: { type: 'number', about: '0 none, 1 coordinator, 2 HOD and owner' },
      planned_fix_at: { type: 'date', about: 'when the fix is due' },
      resolved_at: { type: 'date', about: 'when it was fixed' },
      closed_at: { type: 'date', about: 'when it was closed' },
      reopen_count: { type: 'number', about: 'times it came back' },
      created_at: { type: 'date', about: 'when it was raised' },
    },
    defaults: ['number', 'title', 'solver', 'status', 'planned_fix_at'],
  },
  fms_steps: {
    label: 'Process steps',
    about: 'Steps of running process records (FMS): who has which step and whether it is late.',
    columns: {
      process: { type: 'text', about: 'process (flow) name' },
      record_number: { type: 'number', about: 'record number' },
      record: { type: 'text', about: 'record title, e.g. the customer' },
      step: { type: 'text', about: 'step name' },
      doer: { type: 'text', about: 'who has the step' },
      status: { type: 'text', about: 'OPEN or DONE' },
      planned_at: { type: 'date', about: 'when the step is due' },
      done_at: { type: 'date', about: 'when it was done' },
      is_late: { type: 'bool', about: 'open and past its due time' },
      days_late: { type: 'number', about: 'whole days past the due time' },
    },
    defaults: ['process', 'record', 'step', 'doer', 'planned_at'],
  },
  fms_records: {
    label: 'Process records',
    about: 'Each run of a process: an order, a lead, a complaint…',
    columns: {
      process: { type: 'text', about: 'process (flow) name' },
      number: { type: 'number', about: 'record number' },
      title: { type: 'text', about: 'record title' },
      status: { type: 'text', about: 'RUNNING, ON_HOLD, CLOSED or CANCELLED' },
      started_at: { type: 'date', about: 'when it started' },
      closed_at: { type: 'date', about: 'when it closed' },
      started_by: { type: 'text', about: 'who started it' },
    },
    defaults: ['process', 'number', 'title', 'status', 'started_at'],
  },
  people: {
    label: 'People',
    about: 'People of the company: designation, department, login and Telegram.',
    columns: {
      code: { type: 'text', about: 'employee code' },
      name: { type: 'text', about: 'name' },
      designation: { type: 'text', about: 'designation' },
      department: { type: 'text', about: 'main department' },
      status: { type: 'text', about: 'ACTIVE, INACTIVE or LEFT' },
      has_login: { type: 'bool', about: 'can sign in' },
      telegram_linked: { type: 'bool', about: 'Telegram is linked' },
    },
    defaults: ['code', 'name', 'designation', 'department'],
  },
} as const satisfies Record<string, AskView>;
export type AskViewKey = keyof typeof ASK_VIEWS;
export const ASK_VIEW_KEYS = Object.keys(ASK_VIEWS) as AskViewKey[];

export const ASK_OPS = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'in',
  'is_null',
  'not_null',
] as const;
/** Date values may be words, worked out in the company's time zone. */
export const ASK_DATE_WORDS = [
  'now',
  'today',
  'tomorrow',
  'yesterday',
  'start_of_week',
  'end_of_week',
  'start_of_last_week',
  'start_of_month',
  'end_of_month',
  'start_of_last_month',
  'start_of_fy',
] as const;

export const askPlanSchema = z.object({
  answerable: z.boolean().describe('False when none of the views can answer the question'),
  why: z.string().describe('When not answerable: a short reason for the user'),
  view: z.enum(ASK_VIEW_KEYS as [AskViewKey, ...AskViewKey[]]),
  columns: z.array(z.string()).describe('Columns to show; empty for the default ones'),
  filters: z.array(
    z.object({
      column: z.string(),
      op: z.enum(ASK_OPS),
      value: z
        .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
        .nullable()
        .describe('A value, a list for "in", null for is_null / not_null, or a date word'),
    }),
  ),
  groupBy: z.string().nullable().describe('A text column to group by, or null'),
  aggregate: z
    .object({ fn: z.enum(['count', 'sum', 'avg', 'min', 'max']), column: z.string().nullable() })
    .nullable(),
  orderBy: z.object({ column: z.string(), dir: z.enum(['asc', 'desc']) }).nullable(),
  limit: z.number().describe('At most 200'),
});
export type AskPlan = z.infer<typeof askPlanSchema>;

/** Every name in a plan must be in the catalog: returns the problems (empty = safe to run). */
export function checkAskPlan(plan: AskPlan): string[] {
  const view = ASK_VIEWS[plan.view] as AskView | undefined;
  if (!view) return [`Unknown view "${plan.view}"`];
  const cols = view.columns;
  const bad: string[] = [];
  const need = (c: string | null | undefined, what: string) => {
    if (c && !(c in cols)) bad.push(`Unknown ${what} "${c}"`);
  };
  plan.columns.forEach((c) => need(c, 'column'));
  for (const f of plan.filters) {
    need(f.column, 'filter column');
    const isNullOp = f.op === 'is_null' || f.op === 'not_null';
    if (!isNullOp && (f.value === null || f.value === undefined))
      bad.push(`Filter on "${f.column}" needs a value`);
    if (f.op === 'in' && !Array.isArray(f.value)) bad.push(`Filter "in" on "${f.column}" needs a list`);
  }
  need(plan.groupBy, 'group');
  if (plan.groupBy && cols[plan.groupBy as keyof typeof cols]?.type !== 'text')
    bad.push('Group only by a text column');
  if (plan.aggregate?.column) {
    need(plan.aggregate.column, 'column');
    const t = cols[plan.aggregate.column as keyof typeof cols]?.type;
    if (plan.aggregate.fn !== 'count' && t !== 'number' && t !== 'date')
      bad.push(`Can't ${plan.aggregate.fn} a ${t ?? 'missing'} column`);
  }
  // A grouped answer may be sorted by its number ("value").
  if (plan.orderBy && plan.orderBy.column !== 'value') need(plan.orderBy.column, 'sort column');
  return bad;
}
