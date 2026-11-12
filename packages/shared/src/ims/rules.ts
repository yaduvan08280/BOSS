import { z } from 'zod';
import { overrideOf } from '../hr/rules';

/** CLAUDE.md §10.1 — the four IMS rule sets, with the defaults shown there. */
export const maxRulesSchema = z.object({
  /** Daily use is the average over the last N days. */
  useDays: z.number().int().min(7).max(365).default(120),
  /** Every item's MAX is reviewed every N days. */
  reviewEveryDays: z.number().int().min(1).max(180).default(15),
  /** Red on this many days of the review period → raise the safety factor. */
  raiseAfterRedDays: z.number().int().min(1).max(90).default(3),
  /** Purple on this share of the review period → lower it. */
  lowerWhenPurplePct: z.number().int().min(1).max(100).default(50),
  safetyStep: z.number().min(0.05).max(2).default(0.25),
  lowestSafety: z.number().min(0.5).max(5).default(1),
});

export const owsRulesSchema = z.object({
  /** The day orders are made (1 = Monday … 7 = Sunday). */
  orderWeekday: z.number().int().min(1).max(7).default(1),
  /** The order list is ready this many days before the order day. */
  daysAhead: z.number().int().min(0).max(6).default(1),
});

export const turnsRulesSchema = z.object({
  /** Non-moving / slow (NOS): fewer turns a year than this. */
  nosTurnsBelow: z.number().min(0.5).max(100).default(10),
  /** NOS should be at most this share of stock value. */
  nosTargetPct: z.number().int().min(0).max(100).default(50),
  /** Turns should grow by this much each quarter. */
  turnsGrowthPct: z.number().int().min(0).max(200).default(26),
  /** The bottom N% of items by turns are offered for stopping. */
  stopBottomPct: z.number().int().min(1).max(100).default(20),
});

export const auditRulesSchema = z.object({
  /** Each cycle the top N items by stock value are counted. */
  topByValue: z.number().int().min(1).max(1000).default(50),
  cycleDays: z.number().int().min(7).max(365).default(30),
  /** No movement for this many days = dead stock. */
  deadAfterDays: z.number().int().min(30).max(1095).default(365),
});

/** §10.2 Who does what, and who approves stock adjustments (damaged, expired, lost, found, count). */
export const imsPeopleSchema = z.object({
  storeKeeperIds: z.array(z.string()).max(20).default([]),
  purchaseIds: z.array(z.string()).max(20).default([]),
  reviewerIds: z.array(z.string()).max(20).default([]),
  auditIds: z.array(z.string()).max(20).default([]),
  approverIds: z.array(z.string()).max(20).default([]),
  /** One approver's yes is enough (else every approver must say yes). */
  anyOne: z.boolean().default(true),
  /** Nobody approves an adjustment they made. */
  neverOwn: z.boolean().default(true),
  /** The owner can always approve, listed or not. */
  ownerAlways: z.boolean().default(true),
});

/** Phase 13: how stock is valued, when waste needs a yes, when a count is flagged, expiry warnings, emergencies. */
export const stockRulesSchema = z.object({
  valuation: z.enum(['AVG', 'FIFO']).default('AVG'),
  /** Waste worth more than this (paise) waits for an approver. */
  wasteApproveOverPaise: z.number().int().min(0).max(1e12).default(500_00),
  /** A count's difference above this % of what should have been used is flagged. */
  varianceFlagPct: z.number().min(0).max(100).default(5),
  expiryAlertDays: z.number().int().min(0).max(365).default(7),
  /** An emergency outlet-to-outlet transfer needs a yes from one side or from both. */
  emergencyApprovals: z.enum(['one', 'both']).default('both'),
});
export type StockRules = z.infer<typeof stockRulesSchema>;

export const imsRulesSchema = z.object({
  stock: stockRulesSchema.default(stockRulesSchema.parse({})),
  max: maxRulesSchema.default(maxRulesSchema.parse({})),
  ows: owsRulesSchema.default(owsRulesSchema.parse({})),
  turns: turnsRulesSchema.default(turnsRulesSchema.parse({})),
  audit: auditRulesSchema.default(auditRulesSchema.parse({})),
  people: imsPeopleSchema.default(imsPeopleSchema.parse({})),
});
export type ImsRules = z.infer<typeof imsRulesSchema>;
export type MaxRules = z.infer<typeof maxRulesSchema>;
export const DEFAULT_IMS_RULES: ImsRules = imsRulesSchema.parse({});

/** Saving one rule set: only what is sent changes. */
export const imsRulesPatchSchema = z.object({
  stock: overrideOf(stockRulesSchema).optional(),
  max: overrideOf(maxRulesSchema).optional(),
  ows: overrideOf(owsRulesSchema).optional(),
  turns: overrideOf(turnsRulesSchema).optional(),
  audit: overrideOf(auditRulesSchema).optional(),
  people: overrideOf(imsPeopleSchema).optional(),
});

export const ITEM_UNITS = [
  'pcs',
  'nos',
  'kg',
  'g',
  'ton',
  'ltr',
  'ml',
  'm',
  'mm',
  'sqft',
  'sqm',
  'box',
  'bag',
  'roll',
  'set',
  'pair',
] as const;

export const itemSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  unit: z.string().trim().min(1).max(12).default('pcs'),
  category: z.string().trim().max(60).nullish(),
  location: z.string().trim().max(60).nullish(),
  leadTimeDays: z.number().int().min(0).max(365).default(7),
  safetyFactor: z.number().min(0.5).max(10).default(1.5),
  /** Set by hand until the first review works it out from use; null = not set yet. */
  maxQty: z.number().min(0).max(1e9).nullish(),
  minQty: z.number().min(0).max(1e9).nullish(),
  /** Paise per unit. */
  ratePaise: z.number().int().min(0).max(1e13).default(0),
  vendor: z.string().trim().max(120).nullish(),
  active: z.boolean().default(true),
});
export type ItemInput = z.infer<typeof itemSchema>;

export const ADJUST_REASONS = ['DAMAGED', 'EXPIRED', 'LOST', 'FOUND', 'COUNT'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];
export const MOVE_TYPES = ['IN', 'OUT', 'TRANSFER', 'ADJUST'] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

export const moveSchema = z
  .object({
    itemId: z.string(),
    type: z.enum(MOVE_TYPES),
    /** IN / OUT / TRANSFER: how much (positive). ADJUST: + found / − damaged, expired, lost. */
    qty: z.number().refine((n) => n !== 0 && Number.isFinite(n), 'Enter a quantity'),
    ratePaise: z.number().int().min(0).max(1e13).nullish(),
    reason: z.enum(ADJUST_REASONS).nullish(),
    fromLocation: z.string().trim().max(60).nullish(),
    toLocation: z.string().trim().max(60).nullish(),
    note: z.string().trim().max(500).nullish(),
    /** When it happened (offline entry); default now. */
    at: z.iso.datetime({ offset: true }).nullish(),
  })
  .refine((m) => m.type === 'ADJUST' || m.qty > 0, { path: ['qty'], message: 'Quantity must be more than 0' })
  .refine((m) => m.type !== 'ADJUST' || m.reason, { path: ['reason'], message: 'Why is the stock changing?' })
  .refine((m) => m.type !== 'TRANSFER' || m.toLocation, { path: ['toLocation'], message: 'Where to?' });
export type MoveInput = z.infer<typeof moveSchema>;
