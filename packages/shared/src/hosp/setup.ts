import { z } from 'zod';

/**
 * Phase 14 — hospitality set-up (shared schemas and pure rules): outlets, stations, floors and tables, rooms,
 * charges, printers, discounts, day-close rules. Nothing here is a default for a country: tax rates and charges
 * are typed by the company.
 */
const name = z.string().trim().min(1).max(80);
const minute = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);
const paise = z.number().int().min(0).max(1e13);

export const OUTLET_KINDS = [
  'RESTAURANT',
  'BAR',
  'CAFE',
  'ROOM_SERVICE',
  'BANQUET',
  'POOL_BAR',
  'COUNTER',
] as const;
export type OutletKind = (typeof OUTLET_KINDS)[number];

/** What an outlet adds to a bill. The service charge is always the guest's choice: it can be taken off any bill. */
export const chargesSchema = z.object({
  serviceChargePct: z.number().min(0).max(30).default(0),
  packagingPaise: paise.default(0),
  deliveryPaise: paise.default(0),
  /** Round the bill to the nearest: 1 = a rupee, 0 = no round-off. */
  roundTo: z.number().int().min(0).max(100).default(1),
  /** A tax code (money core) on the charges themselves, when the accountant says they are taxed. */
  chargeTaxCode: z.string().trim().max(20).nullish(),
  /** The outlet's UPI id (name@bank): bills carry a pay link for it. */
  upiId: z.string().trim().max(80).nullish(),
});
export type OutletCharges = z.infer<typeof chargesSchema>;

export const outletSchema = z.object({
  name,
  kind: z.enum(OUTLET_KINDS).default('RESTAURANT'),
  branchId: z.string().min(1),
  /** Where its stock is taken from (a location of the branch; "" = the main store). */
  locationId: z.string().default(''),
  /** Menu categories whose stock is taken from another location of the branch (drinks from the bar). */
  stockRoutes: z
    .array(z.object({ category: z.string().trim().min(1).max(60), locationId: z.string().min(1) }))
    .max(60)
    .default([]),
  priceListId: z.string().nullish(),
  openMin: minute.default(0),
  closeMin: minute.default(24 * 60),
  charges: chargesSchema.default(chargesSchema.parse({})),
  billPrinterId: z.string().nullish(),
  active: z.boolean().default(true),
});

export const STATION_KINDS = ['KITCHEN', 'TANDOOR', 'BAR', 'DESSERT', 'PANTRY', 'OTHER'] as const;
export const stationSchema = z.object({
  outletId: z.string().min(1),
  name,
  kind: z.enum(STATION_KINDS).default('KITCHEN'),
  printerId: z.string().nullish(),
  /** Shown on a kitchen display. */
  display: z.boolean().default(true),
});
export const PRINTER_KINDS = ['KOT', 'BILL'] as const;
export const printerSchema = z.object({
  name,
  branchId: z.string().nullish(),
  kind: z.enum(PRINTER_KINDS).default('KOT'),
  /** NETWORK: the server prints to ip:port; AGENT: through the branch's site agent. */
  connection: z.enum(['NETWORK', 'AGENT']).default('NETWORK'),
  address: z.string().trim().max(120).nullish(),
});
/** Which station a menu category's tickets go to at an outlet ("" = every other category). */
export const kotRouteSchema = z.object({
  outletId: z.string().min(1),
  routes: z.array(z.object({ category: z.string().trim().max(60), stationId: z.string().min(1) })).max(200),
});

export const TABLE_SHAPES = ['SQUARE', 'ROUND', 'RECT'] as const;
export const tableSchema = z.object({
  floorId: z.string().min(1),
  name: z.string().trim().min(1).max(20),
  seats: z.number().int().min(1).max(60).default(4),
  shape: z.enum(TABLE_SHAPES).default('SQUARE'),
  /** Position on the plan, in grid cells (the plan is 24 cells wide). */
  x: z.number().int().min(0).max(200).default(0),
  y: z.number().int().min(0).max(400).default(0),
  section: z.string().trim().max(40).nullish(),
  combinable: z.boolean().default(false),
  stewardIds: z.array(z.string()).max(20).default([]),
});
export const tablesBulkSchema = z.object({
  floorId: z.string().min(1),
  count: z.number().int().min(1).max(200),
  prefix: z.string().trim().max(8).default('T'),
  from: z.number().int().min(1).max(9999).default(1),
  seats: z.number().int().min(1).max(60).default(4),
  section: z.string().trim().max(40).nullish(),
});
/** Where the n-th table of a bulk add goes: rows of six, two cells apart. */
export const gridSpot = (n: number, perRow = 6) => ({ x: (n % perRow) * 4, y: Math.floor(n / perRow) * 4 });

export const roomTypeSchema = z.object({
  branchId: z.string().min(1),
  name,
  code: z.string().trim().min(1).max(10),
  occupancy: z.number().int().min(1).max(20).default(2),
  maxOccupancy: z.number().int().min(1).max(20).default(3),
  beds: z.string().trim().max(60).nullish(),
  amenities: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  photoIds: z.array(z.string()).max(20).default([]),
  /** The declared tariff for a night, minor units (the tax slab is chosen by it). */
  tariff: paise.nullish(),
  taxCode: z.string().trim().max(20).nullish(),
});
export const roomSchema = z.object({
  typeId: z.string().min(1),
  number: z.string().trim().min(1).max(12),
  floor: z.string().trim().max(20).nullish(),
  features: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** Room numbers this room has a connecting door to. */
  connectsTo: z.array(z.string().trim().min(1).max(12)).max(6).default([]),
});
export const roomsBulkSchema = z.object({
  typeId: z.string().min(1),
  from: z.number().int().min(1).max(99999),
  to: z.number().int().min(1).max(99999),
  floor: z.string().trim().max(20).nullish(),
});

export const DISCOUNT_KINDS = ['PERCENT', 'AMOUNT'] as const;
export const DISCOUNT_ON = ['BILL', 'ITEM'] as const;
export const discountTypeSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,29}$/),
  name,
  kind: z.enum(DISCOUNT_KINDS),
  on: z.enum(DISCOUNT_ON).default('BILL'),
  /** A fixed value (10 % staff discount); left out, the person types it within their limit. */
  value: z.number().min(0).max(1e13).nullish(),
});
export const roleLimitSchema = z.object({
  roleId: z.string().min(1),
  /** The most this role may give by itself; anything above waits for an approver. */
  maxPct: z.number().min(0).max(100).default(0),
  maxPaise: paise.default(0),
  /** May mark a bill or an item no-charge. */
  nc: z.boolean().default(false),
  /** The most a fired item may be worth for this role to void it alone (0 = always needs an approver). */
  voidPaise: paise.default(0),
});
export const hospRulesSchema = z.object({
  discounts: z.array(discountTypeSchema).max(40).default([]),
  limits: z.array(roleLimitSchema).max(60).default([]),
  /** People who approve what is above a limit (the owner always may). */
  approverIds: z.array(z.string()).max(20).default([]),
  ncReasons: z
    .array(z.string().trim().min(1).max(60))
    .max(30)
    .default(['Owner’s guest', 'Staff meal', 'Complaint recovery']),
  dayClose: z
    .object({
      /** The business day ends at this time: a bill at 01:30 belongs to the day before when the cut-off is 04:00. */
      cutoffMin: minute.default(4 * 60),
      closerIds: z.array(z.string()).max(20).default([]),
      denominations: z
        .array(z.number().int().min(1).max(100000))
        .max(20)
        .default([500, 200, 100, 50, 20, 10, 5, 2, 1]),
      blindCash: z.boolean().default(true),
    })
    .default({
      cutoffMin: 240,
      closerIds: [],
      denominations: [500, 200, 100, 50, 20, 10, 5, 2, 1],
      blindCash: true,
    }),
});
export type HospRules = z.infer<typeof hospRulesSchema>;
export const DEFAULT_HOSP_RULES: HospRules = hospRulesSchema.parse({});

/**
 * May this role give this discount by itself? `pct` is the discount as a share of the amount it is on, `paise`
 * its value. Within the role's limits → yes; above either → it needs an approver. A role with no limit row may
 * give nothing by itself.
 */
export function discountDecision(
  rules: HospRules,
  roleId: string,
  d: { pct: number; paise: number },
): 'allowed' | 'needs_approval' {
  const limit = rules.limits.find((l) => l.roleId === roleId);
  if (!limit) return d.paise > 0 ? 'needs_approval' : 'allowed';
  const overPct = d.pct > limit.maxPct + 1e-9;
  const overAmount = limit.maxPaise > 0 && d.paise > limit.maxPaise;
  return overPct || overAmount ? 'needs_approval' : 'allowed';
}
export const mayNc = (rules: HospRules, roleId: string) =>
  rules.limits.find((l) => l.roleId === roleId)?.nc === true;

/** The business day (YYYY-MM-DD) an instant belongs to: before the cut-off it is still the day before. */
export function businessDay(localDate: string, minuteOfDay: number, cutoffMin: number): string {
  if (minuteOfDay >= cutoffMin) return localDate;
  return new Date(Date.parse(`${localDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Where an outlet takes the stock for a menu category: its own route when it has one, else the outlet's location. */
export function stockPlaceFor(
  outlet: { locationId: string; stockRoutes?: unknown },
  category: string | null | undefined,
): string {
  const routes = Array.isArray(outlet.stockRoutes)
    ? (outlet.stockRoutes as { category?: string; locationId?: string }[])
    : [];
  const key = (category ?? '').trim().toLowerCase();
  const hit = key ? routes.find((r) => (r.category ?? '').trim().toLowerCase() === key) : undefined;
  return hit?.locationId ?? outlet.locationId;
}
