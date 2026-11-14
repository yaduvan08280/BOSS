import { z } from 'zod';
import { hasPermission, type PermissionKey } from '../permissions';

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
  /** Who may read it: people with this right (else everyone who may ask). */
  right?: PermissionKey;
  /**
   * The rows are someone's own (a task, a checklist run, an attendance day): people without `ai.admin` see only
   * theirs. Business data (stock, sales, bookings) has no owner: the right above decides instead.
   */
  personal?: boolean;
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
  stock: {
    label: 'Stock',
    about:
      "What is in stock now, per item and place (store, kitchen, bar, cold room). Quantities are in each item's own unit (kg, litre, ml, pc, bottle); value in rupees.",
    columns: {
      code: { type: 'text', about: 'item code' },
      item: { type: 'text', about: 'item name' },
      category: { type: 'text', about: 'item category, e.g. Vegetables, Dairy, Liquor, Beer' },
      unit: { type: 'text', about: 'the unit qty is in' },
      location: {
        type: 'text',
        about: 'where it is, e.g. "Murlipura kitchen store", "Central cold room", "Main store"',
      },
      location_kind: {
        type: 'text',
        about: 'KITCHEN, BAR, COLD_ROOM or STORE (a place named "… kitchen …" counts as KITCHEN)',
      },
      branch: { type: 'text', about: 'branch of the place' },
      qty: { type: 'number', about: 'quantity there now' },
      value: { type: 'number', about: 'value of that stock in rupees' },
      rate: { type: 'number', about: 'rupees per unit' },
      min_qty: { type: 'number', about: "the item's minimum (whole company)" },
      max_qty: { type: 'number', about: "the item's MAX (whole company)" },
      band: { type: 'text', about: 'red, yellow, green, purple (over MAX) or none — for the whole company' },
      vendor: { type: 'text', about: 'usual vendor' },
    },
    defaults: ['item', 'location', 'qty', 'unit', 'value'],
    right: 'ims.view',
    personal: false,
  },
  stock_moves: {
    label: 'Stock movements',
    about: 'Every receipt, issue, transfer and adjustment of stock (wastage, recipe use by sales, counts).',
    columns: {
      at: { type: 'date', about: 'when' },
      code: { type: 'text', about: 'item code' },
      item: { type: 'text', about: 'item name' },
      category: { type: 'text', about: 'item category' },
      unit: { type: 'text', about: 'the unit qty is in' },
      type: { type: 'text', about: 'IN, OUT, TRANSFER or ADJUST' },
      reason: { type: 'text', about: 'DAMAGED, EXPIRED, LOST, FOUND, COUNT or empty' },
      source: {
        type: 'text',
        about: 'what made it: wastage, recipe (sold), grn (goods receipt), transfer, count…',
      },
      qty: { type: 'number', about: 'quantity moved' },
      value: { type: 'number', about: 'value in rupees' },
      location: { type: 'text', about: 'the place it left (or came into)' },
      to_location: { type: 'text', about: 'where a transfer went' },
      by_person: { type: 'text', about: 'who entered it' },
      status: { type: 'text', about: 'APPLIED, PENDING or REJECTED' },
    },
    defaults: ['at', 'item', 'type', 'qty', 'unit', 'location'],
    right: 'ims.view',
    personal: false,
  },
  sales_items: {
    label: 'Items sold',
    about:
      'Every dish and drink ordered on the POS, by business day and outlet (amounts before tax, in rupees).',
    columns: {
      business_day: {
        type: 'date',
        about: 'the business day (a bill after midnight belongs to the evening before)',
      },
      outlet: { type: 'text', about: 'outlet, e.g. "Rooftop – 4th floor"' },
      order_number: { type: 'number', about: 'order number of that day' },
      order_type: { type: 'text', about: 'DINE_IN, TAKEAWAY, DELIVERY, ROOM_SERVICE…' },
      item: { type: 'text', about: 'dish or drink' },
      variant: { type: 'text', about: 'variant, e.g. Half, Full, 60 ml' },
      category: { type: 'text', about: 'menu category' },
      qty: { type: 'number', about: 'how many' },
      amount: { type: 'number', about: 'price × qty in rupees, before tax' },
      status: { type: 'text', about: 'HELD, FIRED, READY, SERVED or VOID' },
      is_void: { type: 'bool', about: 'taken off the order' },
      void_reason: { type: 'text', about: 'why it was taken off' },
      no_charge: { type: 'bool', about: 'given free' },
      steward: { type: 'text', about: 'steward of the order' },
      ordered_at: { type: 'date', about: 'when it was ordered' },
    },
    defaults: ['business_day', 'outlet', 'item', 'qty', 'amount'],
    right: 'hosp.view',
    personal: false,
  },
  bills: {
    label: 'Restaurant bills',
    about: 'POS bills: total, guests, discount, how they were paid.',
    columns: {
      business_day: { type: 'date', about: 'the business day' },
      outlet: { type: 'text', about: 'outlet' },
      bill_number: { type: 'text', about: 'bill number' },
      total: { type: 'number', about: 'bill total in rupees, with tax' },
      service_charge: { type: 'number', about: 'service charge in rupees' },
      status: { type: 'text', about: 'OPEN, PAID or CANCELLED' },
      guests: { type: 'number', about: 'covers at the table' },
      order_type: { type: 'text', about: 'DINE_IN, TAKEAWAY, DELIVERY, ROOM_SERVICE…' },
      has_discount: { type: 'bool', about: 'a discount was given' },
      discount_reason: { type: 'text', about: 'why' },
      no_charge_reason: { type: 'text', about: 'why the bill was free' },
      paid_by: { type: 'text', about: 'payment modes, e.g. "Cash", "UPI (PhonePe / GPay)"' },
      steward: { type: 'text', about: 'steward' },
      paid_at: { type: 'date', about: 'when it was paid' },
    },
    defaults: ['business_day', 'outlet', 'bill_number', 'total', 'paid_by'],
    right: 'hosp.view',
    personal: false,
  },
  attendance: {
    label: 'Attendance days',
    about: "Each person's settled day: present, late, half day, absent, on leave, holiday or weekly off.",
    columns: {
      date: { type: 'date', about: 'the day' },
      person: { type: 'text', about: 'who' },
      department: { type: 'text', about: 'department' },
      status: { type: 'text', about: 'PRESENT, LATE, HALF_DAY, ABSENT, ON_LEAVE, HOLIDAY or WEEKLY_OFF' },
      in_at: { type: 'date', about: 'first punch in' },
      out_at: { type: 'date', about: 'last punch out' },
      worked_hours: { type: 'number', about: 'hours worked' },
      late_minutes: { type: 'number', about: 'minutes late' },
      overtime_hours: { type: 'number', about: 'overtime hours' },
      missed_out: { type: 'bool', about: 'forgot to punch out' },
    },
    defaults: ['date', 'person', 'status', 'in_at', 'out_at'],
    right: 'hr.view',
  },
  reservations: {
    label: 'Table bookings',
    about: 'Table reservations at the outlets.',
    columns: {
      start_at: { type: 'date', about: 'booked for' },
      outlet: { type: 'text', about: 'outlet' },
      guest: { type: 'text', about: 'guest name' },
      party_size: { type: 'number', about: 'number of guests' },
      status: {
        type: 'text',
        about: 'REQUESTED, CONFIRMED, REMINDED, ARRIVED, SEATED, FINISHED, CANCELLED or NO_SHOW',
      },
      source: { type: 'text', about: 'PHONE, WALK_IN or ONLINE' },
      occasion: { type: 'text', about: 'birthday, anniversary…' },
      deposit: { type: 'text', about: 'DUE, PAID, USED, KEPT, REFUND_DUE, REFUNDED or empty' },
      created_at: { type: 'date', about: 'when it was booked' },
    },
    defaults: ['start_at', 'outlet', 'guest', 'party_size', 'status'],
    right: 'hosp.view',
    personal: false,
  },
  customers: {
    label: 'Customers',
    about:
      'CRM customers (corporate clients, planners, agents) with their last 12 months of sales and what they owe.',
    columns: {
      code: { type: 'text', about: 'customer code' },
      customer: { type: 'text', about: 'customer name' },
      city: { type: 'text', about: 'city' },
      segment: { type: 'text', about: 'dealer, distributor, institution, retail…' },
      handled_by: { type: 'text', about: 'who looks after them' },
      credit_days: { type: 'number', about: 'credit days' },
      is_lost: { type: 'bool', about: 'marked lost' },
      sales_12m: { type: 'number', about: 'invoiced in the last 12 months, rupees' },
      orders_12m: { type: 'number', about: 'invoices in the last 12 months' },
      last_order_on: { type: 'date', about: 'last invoice date' },
      owed: { type: 'number', about: 'what they still owe, rupees' },
    },
    defaults: ['customer', 'city', 'sales_12m', 'orders_12m', 'owed'],
    right: 'crm.view',
    personal: false,
  },
  leads: {
    label: 'Leads',
    about: 'New-business enquiries and leads in the funnel (NBD).',
    columns: {
      number: { type: 'number', about: 'lead number' },
      name: { type: 'text', about: 'contact name' },
      lead_company: { type: 'text', about: 'their company' },
      city: { type: 'text', about: 'city' },
      source: { type: 'text', about: 'where it came from' },
      requirement: { type: 'text', about: 'what they want' },
      stage: { type: 'text', about: 'funnel stage' },
      status: { type: 'text', about: 'ENQUIRY, OPEN, WON or LOST' },
      value: { type: 'number', about: 'expected value, rupees' },
      owner: { type: 'text', about: 'who owns it' },
      next_action: { type: 'text', about: 'next action' },
      next_action_on: { type: 'date', about: 'when' },
      created_at: { type: 'date', about: 'when it came in' },
    },
    defaults: ['name', 'lead_company', 'stage', 'value', 'next_action_on'],
    right: 'crm.view',
  },
  money: {
    label: 'Bills and payments',
    about:
      'Every money paper: INVOICE, RECEIPT, ADVANCE, PURCHASE_BILL, VENDOR_PAYMENT, CREDIT_NOTE, CHALLAN — totals, what is settled, what is owed and how late.',
    columns: {
      type: {
        type: 'text',
        about: 'INVOICE, RECEIPT, ADVANCE, PURCHASE_BILL, VENDOR_PAYMENT, CREDIT_NOTE, DEBIT_NOTE or CHALLAN',
      },
      number: { type: 'text', about: 'paper number' },
      date: { type: 'date', about: 'date of the paper' },
      party: { type: 'text', about: 'customer, guest or vendor' },
      branch: { type: 'text', about: 'branch' },
      status: { type: 'text', about: 'ISSUED, PART_PAID, PAID or CANCELLED' },
      total: { type: 'number', about: 'total with tax, rupees' },
      tax: { type: 'number', about: 'tax, rupees' },
      settled: { type: 'number', about: 'paid or used so far, rupees' },
      balance: { type: 'number', about: 'still open, rupees' },
      due_on: { type: 'date', about: 'due date' },
      days_overdue: { type: 'number', about: 'days past the due date while unpaid (0 otherwise)' },
      source: { type: 'text', about: 'what raised it: pos_check, banquet, crm, folio, grn…' },
    },
    defaults: ['type', 'number', 'date', 'party', 'total', 'balance'],
    right: 'money.view',
    personal: false,
  },
  purchase_orders: {
    label: 'Purchase orders',
    about: 'Orders to vendors and their value.',
    columns: {
      number: { type: 'text', about: 'PO number' },
      vendor: { type: 'text', about: 'vendor' },
      status: { type: 'text', about: 'DRAFT, SENT, PART_RECEIVED, RECEIVED, CLOSED or CANCELLED' },
      expected_on: { type: 'date', about: 'expected delivery' },
      value: { type: 'number', about: 'order value, rupees' },
      lines: { type: 'number', about: 'number of items' },
      raised_by: { type: 'text', about: 'who raised it' },
      created_at: { type: 'date', about: 'when' },
    },
    defaults: ['number', 'vendor', 'status', 'value', 'expected_on'],
    right: 'ims.view',
    personal: false,
  },
  hotel_stays: {
    label: 'Hotel stays',
    about: 'Room bookings: who, which room type, dates, nights, status and source (OTA, direct…).',
    columns: {
      number: { type: 'text', about: 'booking number' },
      guest: { type: 'text', about: 'guest' },
      room_type: { type: 'text', about: 'room type' },
      property: { type: 'text', about: 'hotel branch' },
      arrive: { type: 'date', about: 'arrival day' },
      depart: { type: 'date', about: 'departure day' },
      nights: { type: 'number', about: 'nights' },
      status: { type: 'text', about: 'BOOKED, CHECKED_IN, CHECKED_OUT, CANCELLED or NO_SHOW' },
      source: { type: 'text', about: 'DIRECT, PHONE, WALK_IN, WEBSITE, AGENT or OTA' },
      channel: { type: 'text', about: 'OTA name when from a channel' },
      kind: { type: 'text', about: 'INDIVIDUAL, GROUP, CORPORATE or AGENT' },
      adults: { type: 'number', about: 'adults' },
      checked_in_at: { type: 'date', about: 'check-in time' },
    },
    defaults: ['number', 'guest', 'room_type', 'arrive', 'nights', 'status'],
    right: 'hosp.view',
    personal: false,
  },
  banquets: {
    label: 'Banquet events',
    about: 'Weddings, parties and conferences: covers, status and quoted value.',
    columns: {
      number: { type: 'text', about: 'event number' },
      guest: { type: 'text', about: 'client' },
      occasion: { type: 'text', about: 'occasion' },
      branch: { type: 'text', about: 'branch' },
      start_at: { type: 'date', about: 'when it starts' },
      expected_covers: { type: 'number', about: 'expected guests' },
      guaranteed_covers: { type: 'number', about: 'guaranteed guests' },
      actual_covers: { type: 'number', about: 'guests who came' },
      status: { type: 'text', about: 'ENQUIRY, QUOTED, CONFIRMED, COMPLETED, CLOSED, LOST or CANCELLED' },
      quote_total: { type: 'number', about: 'quoted total, rupees' },
    },
    defaults: ['number', 'guest', 'occasion', 'start_at', 'status', 'quote_total'],
    right: 'hosp.view',
    personal: false,
  },
  leave: {
    label: 'Leave requests',
    about: 'Leave asked for, approved or refused.',
    columns: {
      person: { type: 'text', about: 'who' },
      department: { type: 'text', about: 'department' },
      leave_type: { type: 'text', about: 'CL, SL, EL…' },
      from_day: { type: 'date', about: 'first day' },
      to_day: { type: 'date', about: 'last day' },
      days: { type: 'number', about: 'days' },
      status: { type: 'text', about: 'PENDING, APPROVED, REJECTED or CANCELLED' },
      reason: { type: 'text', about: 'why' },
    },
    defaults: ['person', 'leave_type', 'from_day', 'days', 'status'],
    right: 'hr.view',
  },
  menu: {
    label: 'Menu and food cost',
    about: 'Dishes and drinks: price, recipe cost (an estimate from ingredient rates) and food cost %.',
    columns: {
      dish: { type: 'text', about: 'dish or drink' },
      category: { type: 'text', about: 'menu category' },
      price: { type: 'number', about: 'menu price, rupees' },
      diet: { type: 'text', about: 'VEG, NONVEG or EGG' },
      active: { type: 'bool', about: 'on the menu' },
      sold_out: { type: 'bool', about: 'switched off (86)' },
      recipe_cost: { type: 'number', about: 'ingredient cost, rupees (estimate)' },
      food_cost_pct: { type: 'number', about: 'recipe cost as % of price' },
    },
    defaults: ['dish', 'category', 'price', 'recipe_cost', 'food_cost_pct'],
    right: 'hosp.view',
    personal: false,
  },
  licences: {
    label: 'Licences and compliance',
    about: 'Licences, NOCs and recurring duties (pest control) with the day they run out.',
    columns: {
      name: { type: 'text', about: 'what it is' },
      kind: { type: 'text', about: 'FSSAI, LIQUOR, FIRE_NOC, MUSIC, LIFT, PEST_CONTROL…' },
      branch: { type: 'text', about: 'branch' },
      number: { type: 'text', about: 'licence number' },
      authority: { type: 'text', about: 'issued by' },
      expires_on: { type: 'date', about: 'runs out / next due' },
      days_left: { type: 'number', about: 'days left (negative = run out)' },
    },
    defaults: ['name', 'branch', 'expires_on', 'days_left'],
    right: 'hosp.view',
    personal: false,
  },
} as const satisfies Record<string, AskView>;

export type AskViewKey = keyof typeof ASK_VIEWS;
export const ASK_VIEW_KEYS = Object.keys(ASK_VIEWS) as AskViewKey[];

/** The views this person may ask about (their rights), for the planner and the check. */
export function askViewsFor(permissions: readonly string[]): AskViewKey[] {
  return ASK_VIEW_KEYS.filter((k) => {
    const r = (ASK_VIEWS[k] as AskView).right;
    return !r || hasPermission(permissions, r as PermissionKey);
  });
}

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
  report: z
    .string()
    .nullable()
    .describe('The id of a saved report that answers the question as it stands, else null'),
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
