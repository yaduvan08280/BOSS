import { z } from 'zod';
import { splitExact, splitGrid } from './split';

/** CLAUDE.md §11.1 — the CRM configuration pages. */
export const BUSINESS_TYPES = ['manufacturing', 'trading', 'services', 'retail', 'projects'] as const;
export const SELL_TO = ['b2b', 'b2c', 'dealers', 'export', 'government'] as const;
export const SEATS = [
  'owner',
  'crrSc',
  'osr',
  'crm',
  'nbdSc',
  'salesRep',
  'marketing',
  'ea',
  'mis',
  'pc',
  'productionPc',
] as const;
export type Seat = (typeof SEATS)[number];
/** Seats that carry a sales target: the owner (their own clients), CRR (existing clients) and NBD (new ones). */
export const CRR_SEATS: Seat[] = ['crrSc', 'osr'];
export const NBD_SEATS: Seat[] = ['nbdSc', 'salesRep'];
export const SEGMENTS = ['dealer', 'distributor', 'contractor', 'oem', 'institution', 'retail'] as const;
export const LEAD_STAGES_DEFAULT = [
  { key: 'contact', name: 'First contact', days: 3 },
  { key: 'meeting', name: 'Meeting', days: 7 },
  { key: 'demo', name: 'Demo / sample / trial', days: 10 },
  { key: 'proposal', name: 'Proposal in person', days: 7 },
  { key: 'negotiation', name: 'Negotiation', days: 10 },
];

const stepTime = z.object({
  value: z.number().min(0).max(1000),
  unit: z.enum(['hours', 'days']),
  /** previous step / record start / before-or-on the promised date / on the payment due date */
  anchor: z.enum(['previous', 'start', 'promised', 'paymentDue']),
});
export const afterOrderStepSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  name: z.string().trim().min(2).max(80),
  seat: z.enum(SEATS),
  time: stepTime,
  documents: z.array(z.string().trim().min(1).max(60)).max(6).default([]),
  proof: z.boolean().default(false),
});
export type AfterOrderStep = z.infer<typeof afterOrderStepSchema>;
export const DEFAULT_AFTER_ORDER: AfterOrderStep[] = [
  {
    key: 'confirm',
    name: 'Confirm order',
    seat: 'crm',
    time: { value: 2, unit: 'hours', anchor: 'start' },
    documents: ['Order confirmation'],
    proof: false,
  },
  {
    key: 'dispatch',
    name: 'Dispatch / delivery',
    seat: 'crm',
    time: { value: 0, unit: 'days', anchor: 'promised' },
    documents: ['Invoice', 'E-way bill'],
    proof: true,
  },
  {
    key: 'documents',
    name: 'Documents to customer',
    seat: 'crm',
    time: { value: 2, unit: 'days', anchor: 'previous' },
    documents: ['Invoice copy', 'Delivery proof'],
    proof: false,
  },
  {
    key: 'followup',
    name: 'Payment follow-up',
    seat: 'crm',
    time: { value: 0, unit: 'days', anchor: 'paymentDue' },
    documents: ['Statement'],
    proof: false,
  },
  {
    key: 'received',
    name: 'Payment received',
    seat: 'crm',
    time: { value: 2, unit: 'days', anchor: 'previous' },
    documents: ['Receipt'],
    proof: false,
  },
];

const tagDef = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,30}$/),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
const fieldDef = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/),
  label: z.string().trim().min(1).max(60),
  show: z.boolean().default(true),
  required: z.boolean().default(false),
});

export const crmConfigSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES).default('manufacturing'),
  sellTo: z.array(z.enum(SELL_TO)).max(5).default(['b2b', 'dealers']),
  /** Who sits in each seat (one person may hold several); `marketingAgency` = an outside agency's name. */
  seats: z.partialRecord(z.enum(SEATS), z.array(z.string()).max(20)).default({}),
  marketingAgency: z.string().trim().max(80).nullish(),
  split: z
    .object({
      crrPct: z.number().int().min(0).max(100).default(50),
      gpFollows: z.boolean().default(true),
      /** Sales from the owner's own (top 20%) clients this year, paise; carved out of CRR. */
      ownerAmount: z.number().int().min(0).max(1e15).default(0),
      /** Share of a side's target per seat (else equal per person in the side's seats). */
      seatWeights: z.record(z.string(), z.number().min(0).max(100)).default({}),
    })
    .default({ crrPct: 50, gpFollows: true, ownerAmount: 0, seatWeights: {} }),
  customers: z
    .object({
      newOrders: z.number().int().min(1).max(50).default(3),
      newDays: z.number().int().min(1).max(730).default(90),
      /** first: new until either is reached · both: until both are */
      newRule: z.enum(['first', 'both']).default('first'),
      sleepingDays: z.number().int().min(7).max(730).default(60),
      lostDays: z.number().int().min(14).max(1095).default(180),
      vampire: z.boolean().default(true),
    })
    .default({ newOrders: 3, newDays: 90, newRule: 'first', sleepingDays: 60, lostDays: 180, vampire: true }),
  afterOrder: z.array(afterOrderStepSchema).min(1).max(15).default(DEFAULT_AFTER_ORDER),
  nbd: z
    .object({
      sources: z
        .array(z.string().trim().min(1).max(40))
        .max(30)
        .default([
          'Website',
          'Google / Meta ads',
          'IndiaMART / portals',
          'Reference',
          'Dream 100',
          'Exhibition',
          'Tender portal',
        ]),
      fields: z
        .object({
          company: z.boolean().default(true),
          email: z.boolean().default(true),
          budget: z.boolean().default(true),
          when: z.boolean().default(true),
        })
        .default({ company: true, email: true, budget: true, when: true }),
      questions: z
        .array(z.string().trim().min(3).max(120))
        .max(10)
        .default(['Talking to the person who decides?', 'Need is confirmed?']),
      stages: z
        .array(
          z.object({
            key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/),
            name: z.string().trim().min(2).max(40),
            days: z.number().int().min(1).max(365),
          }),
        )
        .min(1)
        .max(10)
        .default(LEAD_STAGES_DEFAULT),
    })
    .default({
      sources: [
        'Website',
        'Google / Meta ads',
        'IndiaMART / portals',
        'Reference',
        'Dream 100',
        'Exhibition',
        'Tender portal',
      ],
      fields: { company: true, email: true, budget: true, when: true },
      questions: ['Talking to the person who decides?', 'Need is confirmed?'],
      stages: LEAD_STAGES_DEFAULT,
    }),
  scot: z
    .object({
      callBeforeDays: z.number().int().min(0).max(30).default(5),
      bestTime: z.enum(['morning', 'afternoon', 'evening']).default('morning'),
      includeSleeping: z.boolean().default(true),
      moveOffHolidays: z.boolean().default(true),
    })
    .default({ callBeforeDays: 5, bestTime: 'morning', includeSleeping: true, moveOffHolidays: true }),
  tags: z
    .array(tagDef)
    .max(30)
    .default([
      { key: 'key_account', name: 'Key account', color: '#2563eb' },
      { key: 'price_sensitive', name: 'Price sensitive', color: '#d97706' },
      { key: 'referrals', name: 'Gives referrals', color: '#16a34a' },
    ]),
  /** Your own fields per record type (System Master → Sales CRM). */
  fields: z
    .object({
      lead: z.array(fieldDef).max(20).default([]),
      customer: z.array(fieldDef).max(20).default([]),
      order: z.array(fieldDef).max(20).default([]),
      quotation: z.array(fieldDef).max(20).default([]),
    })
    .default({ lead: [], customer: [], order: [], quotation: [] }),
  /** Setup pages marked done (the journey's progress). */
  done: z.array(z.string().max(30)).max(20).default([]),
});
export type CrmConfig = z.infer<typeof crmConfigSchema>;
export const DEFAULT_CRM_CONFIG: CrmConfig = crmConfigSchema.parse({});

/** The 15 setup pages in order (Plan the Year 4, CRM configuration 7, Settings 4). */
export const SETUP_PAGES = [
  'year',
  'quarters',
  'months',
  'weeks',
  'business',
  'sellTo',
  'seats',
  'split',
  'customerRules',
  'afterOrder',
  'nbd',
  'holidays',
  'weeklyOff',
  'seasons',
  'rounding',
] as const;
export type SetupPage = (typeof SETUP_PAGES)[number];

export type SeatTargets = {
  crr: number;
  nbd: number;
  owner: number;
  /** One row per (seat, person) with a target: the year and its 12 months (adding up exactly). */
  rows: { seat: Seat; userId: string | null; year: number; months: number[] }[];
  warnings: { code: string; seat?: Seat }[];
};

/**
 * Target split (§11.1 page 4): CRR (existing clients) and NBD (new ones) from the year target; the owner's
 * own clients come out of CRR; each side shared by its seats' people (by weight, else equally); each person's
 * year spread over the months like the plan. "Science check" names what doesn't hold.
 */
export function seatTargets(months: number[], config: CrmConfig, unit = 1): SeatTargets {
  const year = months.reduce((a, b) => a + b, 0);
  const [crr, nbd] = splitExact(year, [config.split.crrPct, 100 - config.split.crrPct]);
  const warnings: SeatTargets['warnings'] = [];
  const owner = Math.min(config.split.ownerAmount, crr!);
  if (config.split.ownerAmount > crr!) warnings.push({ code: 'ownerOverCrr' });
  const holders = (seat: Seat) => config.seats[seat] ?? [];
  const side = (total: number, seats: Seat[]) => {
    const people = seats.flatMap((seat) => holders(seat).map((userId) => ({ seat, userId })));
    for (const seat of seats)
      if (!holders(seat).length && total > 0) warnings.push({ code: 'emptySeat', seat });
    if (!people.length) return total > 0 ? [{ seat: seats[0]!, userId: null, year: total }] : [];
    const w = people.map((p) => config.split.seatWeights[`${p.seat}:${p.userId}`] ?? 1);
    return splitExact(total, w, unit).map((y, i) => ({ ...people[i]!, year: y }));
  };
  const rows = [
    ...(owner > 0 ? [{ seat: 'owner' as Seat, userId: holders('owner')[0] ?? null, year: owner }] : []),
    ...side(crr! - owner, CRR_SEATS),
    ...side(nbd!, NBD_SEATS),
  ];
  // Every person's months add up to their year, and every month's seats to the month's target.
  const table = splitGrid(
    rows.map((r) => r.year),
    months,
  );
  const withMonths = rows.map((r, i) => ({ ...r, months: table[i]! }));
  if (nbd! > 0 && !config.nbd.sources.length) warnings.push({ code: 'noLeadSources' });
  if (!holders('crm').length) warnings.push({ code: 'emptySeat', seat: 'crm' });
  if (!holders('owner').length) warnings.push({ code: 'noOwner' });
  return { crr: crr!, nbd: nbd!, owner, rows: withMonths, warnings };
}
