import { z } from 'zod';
import { guestMobile } from './reservations';

/**
 * Phase 18 — banquets, the bar's excise register, and compliance (shared schemas and pure rules): halls and
 * packages, what an event's quotation comes to, the advance that confirms it, what a cancellation gives back,
 * bottles and ml for the excise register, dry days, licence states and reminders, temperature limits.
 */
const id = z.string().min(1).max(40);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');
const paise = z.number().int().min(0).max(1e13);
const minute = z.number().int().min(0).max(2880);
const tax = z.string().trim().max(20).nullish();

export const hallSchema = z.object({
  branchId: id,
  name: z.string().trim().min(1).max(60),
  /** The most guests by the way the hall is set: theatre, round tables, standing … */
  capacities: z
    .array(z.object({ style: z.string().trim().min(1).max(30), guests: z.number().int().min(1).max(100000) }))
    .min(1)
    .max(10),
  rent: paise.default(0),
  rentTaxCode: tax,
});
export const packageSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pricePerPlate: paise,
  taxCode: tax,
  /** The dishes of the package: a stock item with a recipe (for the indent), and how much of it a guest gets. */
  items: z
    .array(
      z.object({
        itemId: id.nullish(),
        name: z.string().trim().min(1).max(80),
        perCover: z.number().positive().max(100).default(1),
      }),
    )
    .max(80)
    .default([]),
});
export type PackageItem = z.infer<typeof packageSchema>['items'][number];

export const enquirySchema = z.object({
  branchId: id,
  guest: z.object({
    mobile: guestMobile,
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(120).nullish(),
  }),
  /** A company that pays (its party); left out, the guest pays. */
  companyPartyId: id.nullish(),
  occasion: z.string().trim().min(1).max(80),
  day,
  /** Minutes from the day's midnight (an evening that ends after midnight ends past 1440). */
  startMin: minute,
  endMin: minute,
  hallIds: z.array(id).min(1).max(10),
  style: z.string().trim().max(30).nullish(),
  expectedCovers: z.number().int().min(1).max(100000),
  note: z.string().trim().max(1000).nullish(),
});
export const quoteSchema = z.object({
  packageId: id.nullish(),
  /** The price a plate is quoted at (left out, the package's). */
  pricePerPlate: paise.optional(),
  guaranteedCovers: z.number().int().min(1).max(100000),
  /** Hall rent as quoted (left out, the halls' own rent). */
  hallRent: paise.optional(),
  /** Décor, sound, flowers … */
  extras: z
    .array(z.object({ name: z.string().trim().min(1).max(80), amount: paise, taxCode: tax }))
    .max(40)
    .default([]),
  discount: paise.default(0),
});
export type BanquetQuote = {
  packageId: string | null;
  packageName: string | null;
  pricePerPlate: number;
  taxCode: string | null;
  items: PackageItem[];
  guaranteedCovers: number;
  hallRent: number;
  rentTaxCode: string | null;
  extras: { name: string; amount: number; taxCode?: string | null }[];
  discount: number;
};
/** The covers an event is billed for: what came, never fewer than was guaranteed. */
export const billCovers = (guaranteed: number, actual?: number | null) => Math.max(guaranteed, actual ?? 0);
/** The lines a quotation (or the final bill, with the real covers) is made of. */
export function quoteLines(q: BanquetQuote, covers: number) {
  return [
    ...(q.pricePerPlate > 0
      ? [
          {
            item: `${q.packageName ?? 'Menu'} — per plate`,
            qty: covers,
            rate: q.pricePerPlate,
            taxCode: q.taxCode,
            hsn: '996334',
          },
        ]
      : []),
    ...(q.hallRent > 0
      ? [{ item: 'Hall rent', qty: 1, rate: q.hallRent, taxCode: q.rentTaxCode, hsn: '997212' }]
      : []),
    ...q.extras.map((e) => ({ item: e.name, qty: 1, rate: e.amount, taxCode: e.taxCode ?? null, hsn: null })),
  ];
}

export const banquetRulesSchema = z.object({
  /** The share of the quotation that must be paid to confirm a booking (0 = none). */
  advancePct: z.number().min(0).max(100).default(25),
  /** Cancelled at least this many days before, the advance comes back; later it is kept. */
  cancelFreeDays: z.number().int().min(0).max(365).default(15),
  /** The event-day checklist every event starts with. */
  checklist: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(120),
        dept: z.enum(['KITCHEN', 'SERVICE', 'HOUSEKEEPING']),
      }),
    )
    .max(60)
    .default([
      { text: 'Hall set and cleaned', dept: 'HOUSEKEEPING' },
      { text: 'Buffet and counters laid', dept: 'SERVICE' },
      { text: 'Food ready and tasted', dept: 'KITCHEN' },
      { text: 'Sound and lights checked', dept: 'SERVICE' },
    ]),
});
export type BanquetRules = z.infer<typeof banquetRulesSchema>;
export const advanceNeeded = (rules: Pick<BanquetRules, 'advancePct'>, total: number) =>
  Math.round((total * rules.advancePct) / 10000) * 100;
export const cancelOutcome = (rules: Pick<BanquetRules, 'cancelFreeDays'>, daysBefore: number) =>
  daysBefore >= rules.cancelFreeDays ? ('REFUND' as const) : ('KEEP' as const);

export const EXCISE_FORMATS = ['RAJASTHAN', 'GENERIC'] as const;
export const barRulesSchema = z.object({
  licenceNo: z.string().trim().max(60).nullish(),
  permitNo: z.string().trim().max(60).nullish(),
  licensee: z.string().trim().max(120).nullish(),
  /** Item categories that are liquor (the excise register and dry days are about these). */
  liquorCategories: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  format: z.enum(EXCISE_FORMATS).default('RAJASTHAN'),
  dryDays: z
    .array(z.object({ date: day, reason: z.string().trim().min(1).max(80) }))
    .max(400)
    .default([]),
});
export type BarRules = z.infer<typeof barRulesSchema>;
export const branchRulesSchema = z.object({
  banquet: banquetRulesSchema.default(banquetRulesSchema.parse({})),
  bar: barRulesSchema.default(barRulesSchema.parse({})),
});
export type BranchRules = z.infer<typeof branchRulesSchema>;
export const DEFAULT_BRANCH_RULES: BranchRules = branchRulesSchema.parse({});
export const dryDayOn = (bar: Pick<BarRules, 'dryDays'>, date: string) =>
  bar.dryDays.find((d) => d.date === date) ?? null;
export const isLiquor = (bar: Pick<BarRules, 'liquorCategories'>, category: string | null | undefined) =>
  Boolean(category) && bar.liquorCategories.some((c) => c.toLowerCase() === category!.trim().toLowerCase());
/** A quantity in ml as whole bottles and the ml of the open one (a bottle of `sizeMl`). */
export function bottlesAndMl(ml: number, sizeMl: number) {
  if (!(sizeMl > 0)) return { bottles: 0, ml: Math.round(ml) };
  const bottles = Math.floor((ml + 1e-6) / sizeMl);
  return { bottles, ml: Math.round(ml - bottles * sizeMl) };
}

export const COMPLIANCE_KINDS = [
  'FSSAI',
  'LIQUOR',
  'FIRE_NOC',
  'MUSIC',
  'LIFT',
  'BOILER',
  'POLLUTION',
  'PEST_CONTROL',
  'OTHER',
] as const;
export const complianceSchema = z.object({
  branchId: id,
  kind: z.enum(COMPLIANCE_KINDS),
  name: z.string().trim().min(1).max(100),
  number: z.string().trim().max(60).nullish(),
  authority: z.string().trim().max(100).nullish(),
  issuedOn: day.nullish(),
  /** The day it runs out — or, for something done again and again (pest control), the day it is next due. */
  expiresOn: day,
  /** Done every this many days: marking it done moves the due day on. */
  everyDays: z.number().int().min(1).max(3660).nullish(),
  /** Days before the due day on which people are reminded (and once on the day). */
  remindDays: z.array(z.number().int().min(1).max(365)).max(6).default([60, 30, 7]),
  fileId: id.nullish(),
  note: z.string().trim().max(500).nullish(),
});
export type ComplianceState = 'VALID' | 'EXPIRING' | 'EXPIRED';
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** Valid, about to run out (inside its longest reminder), or run out. */
export function complianceState(expiresOn: string, today: string, remindDays: number[]): ComplianceState {
  const left = daysBetween(today, expiresOn);
  if (left < 0) return 'EXPIRED';
  return left <= Math.max(0, ...remindDays) ? 'EXPIRING' : 'VALID';
}
/**
 * The reminder that is due today, if any: the nearest one already reached (60 → 30 → 7 → the day itself → run
 * out). The key names it, so each is sent once.
 */
export function reminderDue(expiresOn: string, today: string, remindDays: number[]): string | null {
  const left = daysBetween(today, expiresOn);
  if (left < 0) return 'expired';
  if (left === 0) return 'd0';
  const reached = [...remindDays].sort((a, b) => a - b).find((d) => left <= d);
  return reached ? `d${reached}` : null;
}

export const tempPointSchema = z.object({
  branchId: id,
  name: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(10).default('°C'),
  min: z.number().min(-100).max(500).nullish(),
  max: z.number().min(-100).max(500).nullish(),
});
export const tempReadingSchema = z.object({
  value: z.number().min(-100).max(500),
  /** What was done about a reading outside the limits (needed for one). */
  action: z.string().trim().max(300).nullish(),
});
export const inRange = (p: { min?: number | null; max?: number | null }, value: number) =>
  (p.min == null || value >= p.min) && (p.max == null || value <= p.max);
