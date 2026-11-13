import { z } from 'zod';
import { addDays } from '../work/calendar';
import type { RoomHkStatus } from '../machines/hotel';
import { guestMobile } from './reservations';

/**
 * Phase 17 — the hotel (shared schemas and pure rules): rate plans and what a night costs, the restrictions of a
 * day, cancellation and no-show charges, early and late charges, the property's rules, what a foreign guest's
 * Form C needs, which folio a charge goes to, and the night audit's figures.
 */
const id = z.string().min(1).max(40);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');
const paise = z.number().int().min(0).max(1e12);
const minute = z.number().int().min(0).max(1440);
const pct = z.number().min(0).max(100);

export const MEAL_PLANS = ['EP', 'CP', 'MAP', 'AP'] as const;
export type MealPlan = (typeof MEAL_PLANS)[number];
export const RATE_KINDS = ['RACK', 'CORPORATE', 'AGENT'] as const;
export const CANCEL_CHARGES = ['NONE', 'FIRST_NIGHT', 'PERCENT', 'FULL'] as const;
export const NO_SHOW_CHARGES = ['NONE', 'FIRST_NIGHT', 'FULL'] as const;

export const ratePlanSchema = z.object({
  branchId: id,
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_-]{1,12}$/, 'Short capitals, like CP'),
  name: z.string().trim().min(1).max(60),
  /** EP room only · CP with breakfast · MAP breakfast and one meal · AP all meals. */
  meal: z.enum(MEAL_PLANS).default('EP'),
  kind: z.enum(RATE_KINDS).default('RACK'),
  /** The company or travel agent this plan is for (corporate and agent plans). */
  partyId: id.nullish(),
  /** What a travel agent earns on the room charge. */
  commissionPct: pct.default(0),
  rates: z
    .array(
      z.object({
        roomTypeId: id,
        base: paise,
        /** The rate on weekend nights; left out, the base rate. */
        weekend: paise.nullish(),
        /** For each adult above the room type's usual number, and for each child. */
        extraAdult: paise.default(0),
        extraChild: paise.default(0),
      }),
    )
    .min(1)
    .max(60),
  /** Nights that count as the weekend (0 = Sunday … 6 = Saturday): Friday and Saturday nights by default. */
  weekendDays: z.array(z.number().int().min(0).max(6)).max(7).default([5, 6]),
  /** A season changes the rate by a percentage between two days (the first that holds the night wins). */
  seasons: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        from: day,
        to: day,
        pct: z.number().min(-90).max(500),
      }),
    )
    .max(24)
    .default([]),
  /** Staying this many nights or more takes this much off every night (the longest tier reached wins). */
  los: z
    .array(z.object({ nights: z.number().int().min(2).max(365), pctOff: z.number().min(0).max(90) }))
    .max(10)
    .default([]),
  minStay: z.number().int().min(1).max(60).default(1),
  cancel: z
    .object({
      /** Free until this many hours before the arrival day's check-in time. */
      freeHours: z.number().min(0).max(2000).default(24),
      charge: z.enum(CANCEL_CHARGES).default('FIRST_NIGHT'),
      pct: pct.default(0),
    })
    .default({ freeHours: 24, charge: 'FIRST_NIGHT', pct: 0 }),
  noShow: z.enum(NO_SHOW_CHARGES).default('FIRST_NIGHT'),
  active: z.boolean().default(true),
});
export type RatePlanInput = z.infer<typeof ratePlanSchema>;
export type RateRules = Pick<RatePlanInput, 'rates' | 'weekendDays' | 'seasons' | 'los'>;

/** The nights of a stay: every day from the arrival up to, not including, the departure. */
export function stayNights(arrive: string, depart: string): string[] {
  const out: string[] = [];
  for (let d = arrive; d < depart && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/**
 * What one night costs on a plan: the room type's base (or weekend) rate, changed by the season the night falls
 * in, plus the extra adults above the type's usual number and the children, less the length-of-stay discount.
 * Null when the plan does not sell that room type.
 */
export function nightRate(
  plan: RateRules,
  roomTypeId: string,
  night: string,
  who: { adults: number; children: number; occupancy: number },
  nights: number,
): number | null {
  const r = plan.rates.find((x) => x.roomTypeId === roomTypeId);
  if (!r) return null;
  let rate = plan.weekendDays.includes(weekday(night)) && r.weekend != null ? r.weekend : r.base;
  const season = plan.seasons.find((s) => night >= s.from && night <= s.to);
  if (season) rate = rate * (1 + season.pct / 100);
  rate += r.extraAdult * Math.max(0, who.adults - who.occupancy) + r.extraChild * Math.max(0, who.children);
  const tier = [...plan.los].sort((a, b) => b.nights - a.nights).find((t) => nights >= t.nights);
  if (tier) rate = rate * (1 - tier.pctOff / 100);
  // Whole rupees: a tariff is never quoted in paise.
  return Math.round(rate / 100) * 100;
}

export type NightPrice = { day: string; rate: number };
/** Every night of a stay with its rate (null when the plan does not sell the room type). */
export function quoteStay(
  plan: RateRules,
  roomTypeId: string,
  arrive: string,
  depart: string,
  who: { adults: number; children: number; occupancy: number },
): { nights: NightPrice[]; total: number } | null {
  const days = stayNights(arrive, depart);
  const nights: NightPrice[] = [];
  for (const d of days) {
    const rate = nightRate(plan, roomTypeId, d, who, days.length);
    if (rate === null) return null;
    nights.push({ day: d, rate });
  }
  return { nights, total: nights.reduce((n, x) => n + x.rate, 0) };
}

export type DayRule = { stopSell?: boolean; closedToArrival?: boolean; minStay?: number | null };
/** Why a stay can't be sold on these days (null = it can): stop-sell, closed to arrival, the minimum stay. */
export function restriction(
  arrive: string,
  depart: string,
  rules: ReadonlyMap<string, DayRule>,
  planMinStay = 1,
): 'STOP_SELL' | 'CLOSED_TO_ARRIVAL' | 'MIN_STAY' | null {
  const nights = stayNights(arrive, depart);
  if (nights.some((d) => rules.get(d)?.stopSell)) return 'STOP_SELL';
  if (rules.get(arrive)?.closedToArrival) return 'CLOSED_TO_ARRIVAL';
  if (nights.length < Math.max(planMinStay, rules.get(arrive)?.minStay ?? 1)) return 'MIN_STAY';
  return null;
}

/** What cancelling costs: nothing while it is still free; then by the plan — the first night, a share, or all. */
export function cancelCharge(
  cancel: RatePlanInput['cancel'],
  nights: NightPrice[],
  hoursBefore: number,
): number {
  if (hoursBefore >= cancel.freeHours || !nights.length) return 0;
  const total = nights.reduce((n, x) => n + x.rate, 0);
  if (cancel.charge === 'FIRST_NIGHT') return nights[0]!.rate;
  if (cancel.charge === 'FULL') return total;
  if (cancel.charge === 'PERCENT') return Math.round((total * cancel.pct) / 100);
  return 0;
}
export const noShowCharge = (rule: RatePlanInput['noShow'], nights: NightPrice[]) =>
  rule === 'FIRST_NIGHT'
    ? (nights[0]?.rate ?? 0)
    : rule === 'FULL'
      ? nights.reduce((n, x) => n + x.rate, 0)
      : 0;

/** A property's rules. */
export const hotelRulesSchema = z.object({
  /** The public room-booking page of the property is open (phase 19). */
  online: z.boolean().default(false),
  checkInMin: minute.default(14 * 60),
  checkOutMin: minute.default(11 * 60),
  /** Arriving or leaving within this many minutes of the time costs nothing. */
  graceMin: z.number().int().min(0).max(240).default(30),
  /** Early check-in and late check-out, as a share of that night's rate (0 = free). */
  earlyFeePct: pct.default(0),
  lateFeePct: pct.default(0),
  /** Leaving after this time costs the whole night. */
  lateFullMin: minute.default(18 * 60),
  /** A foreign guest's Form C is due this many hours after check-in. */
  formCHours: z.number().min(1).max(72).default(24),
  /** The tax code of room charges when the room type has none (it may carry slabs by tariff). */
  roomTaxCode: z.string().trim().max(20).nullish(),
  /** Things charged to a room: laundry, extra bed, airport cab … */
  extras: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{0,29}$/),
        name: z.string().trim().min(1).max(60),
        kind: z.enum(['LAUNDRY', 'EXTRA']).default('EXTRA'),
        price: paise,
        taxCode: z.string().trim().max(20).nullish(),
      }),
    )
    .max(60)
    .default([]),
  /** What is in the minibar: a stock item, its price to the guest. */
  minibar: z
    .array(
      z.object({
        itemId: id,
        name: z.string().trim().min(1).max(60),
        price: paise,
        taxCode: z.string().trim().max(20).nullish(),
      }),
    )
    .max(60)
    .default([]),
  /** Linen and amenities put in a room when it is cleaned (stock items issued from the housekeeping store). */
  amenities: z
    .array(
      z.object({ itemId: id, name: z.string().trim().min(1).max(60), qty: z.number().positive().max(999) }),
    )
    .max(40)
    .default([]),
  /** Where minibar stock and amenities are taken from ("" = the main store). */
  hkLocationId: z.string().max(40).default(''),
  hkChecklist: z
    .array(z.string().trim().min(1).max(80))
    .max(40)
    .default([
      'Bed made with fresh linen',
      'Bathroom cleaned',
      'Floor cleaned',
      'Amenities refilled',
      'Minibar checked',
    ]),
  /** Who gets guest requests and maintenance tickets, and how fast a request must be done. */
  requestSolverId: id.nullish(),
  maintenanceSolverId: id.nullish(),
  requestSlaMin: z.number().int().min(5).max(1440).default(30),
});
export type HotelRules = z.infer<typeof hotelRulesSchema>;
export const DEFAULT_HOTEL_RULES: HotelRules = hotelRulesSchema.parse({});

/** Early check-in and late check-out charges for the times a guest really came and left (minutes of the day). */
export function earlyFee(rules: HotelRules, arrivedMin: number, firstNight: number) {
  if (!rules.earlyFeePct || arrivedMin >= rules.checkInMin - rules.graceMin) return 0;
  return Math.round((firstNight * rules.earlyFeePct) / 10000) * 100;
}
export function lateFee(rules: HotelRules, leftMin: number, lastNight: number) {
  if (leftMin <= rules.checkOutMin + rules.graceMin) return 0;
  if (leftMin >= rules.lateFullMin && rules.lateFeePct) return lastNight;
  return Math.round((lastNight * rules.lateFeePct) / 10000) * 100;
}

export const STAY_KINDS = ['INDIVIDUAL', 'GROUP', 'CORPORATE', 'AGENT'] as const;
export const STAY_SOURCES = ['DIRECT', 'PHONE', 'WALK_IN', 'WEBSITE', 'AGENT', 'OTA'] as const;
export const bookingInputSchema = z.object({
  branchId: id,
  ratePlanId: id,
  roomTypeId: id,
  /** A room chosen now; left out, one is given at check-in. */
  roomId: id.nullish(),
  arrive: day,
  depart: day,
  adults: z.number().int().min(1).max(20).default(1),
  children: z.number().int().min(0).max(20).default(0),
  guest: z.object({
    mobile: guestMobile,
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(120).nullish(),
  }),
  kind: z.enum(STAY_KINDS).default('INDIVIDUAL'),
  source: z.enum(STAY_SOURCES).default('DIRECT'),
  /** The company that pays (corporate), or the travel agent that sent the guest. */
  companyPartyId: id.nullish(),
  agentPartyId: id.nullish(),
  /** A room of a group block. */
  blockId: id.nullish(),
  note: z.string().trim().max(500).nullish(),
});
export type BookingInput = z.infer<typeof bookingInputSchema>;

export const groupBlockSchema = z.object({
  branchId: id,
  name: z.string().trim().min(1).max(80),
  ratePlanId: id,
  partyId: id.nullish(),
  arrive: day,
  depart: day,
  /** Rooms held, by type. */
  rooms: z
    .array(z.object({ roomTypeId: id, count: z.number().int().min(1).max(500) }))
    .min(1)
    .max(20),
  /** Rooms not taken up by this day go back on sale. */
  releaseOn: day,
  note: z.string().trim().max(500).nullish(),
});

/** What is written down at check-in. A foreign guest's Form C needs the passport, visa and travel details too. */
export const kycSchema = z.object({
  idType: z.string().trim().min(1).max(40),
  idNumber: z.string().trim().min(3).max(40),
  nationality: z.string().trim().min(2).max(40).default('Indian'),
  address: z.string().trim().max(300).nullish(),
  /** Uploaded files: a photo of the ID, the guest's signature. */
  idPhotoId: id.nullish(),
  signatureId: id.nullish(),
  passportNo: z.string().trim().max(30).nullish(),
  visaNo: z.string().trim().max(30).nullish(),
  visaExpiry: day.nullish(),
  arrivedIndiaOn: day.nullish(),
  arrivedFrom: z.string().trim().max(80).nullish(),
  nextDestination: z.string().trim().max(80).nullish(),
  purpose: z.string().trim().max(80).nullish(),
});
export type Kyc = z.infer<typeof kycSchema>;
export const isForeign = (nationality: string | null | undefined) =>
  Boolean(nationality) && !['indian', 'india', 'in'].includes(nationality!.trim().toLowerCase());
export const FORM_C_FIELDS = [
  'passportNo',
  'visaNo',
  'visaExpiry',
  'arrivedIndiaOn',
  'arrivedFrom',
  'nextDestination',
  'purpose',
] as const;
/** What a foreign guest's Form C still lacks (empty = complete; always empty for an Indian guest). */
export const formCMissing = (k: Partial<Kyc>): string[] =>
  isForeign(k.nationality) ? FORM_C_FIELDS.filter((f) => !k[f]) : [];

export const FOLIO_KINDS = [
  'ROOM',
  'FOOD',
  'MINIBAR',
  'LAUNDRY',
  'EXTRA',
  'EARLY',
  'LATE',
  'CANCEL',
  'NO_SHOW',
] as const;
export type FolioKind = (typeof FOLIO_KINDS)[number];
/** A routing rule sends kinds of charge to a folio of the stay (1 = the guest's own). */
export const routingSchema = z
  .array(z.object({ kinds: z.array(z.enum(FOLIO_KINDS)).min(1), folio: z.number().int().min(1).max(9) }))
  .max(9);
export type Routing = z.infer<typeof routingSchema>;
export const routeFolio = (routing: Routing | null | undefined, kind: FolioKind) =>
  routing?.find((r) => r.kinds.includes(kind))?.folio ?? 1;

/** The night audit's figures: occupancy over the rooms that could be sold, the average rate, revenue per room. */
export function auditStats(x: { rooms: number; outOfOrder: number; sold: number; roomRevenue: number }) {
  const sellable = Math.max(0, x.rooms - x.outOfOrder);
  return {
    sellable,
    occupancyPct: sellable ? Math.round((x.sold / sellable) * 1000) / 10 : 0,
    adr: x.sold ? Math.round(x.roomRevenue / x.sold) : 0,
    revPar: sellable ? Math.round(x.roomRevenue / sellable) : 0,
  };
}

/** What the board shows for a room: its housekeeping status and whether a guest is in it. */
export function roomState(hk: RoomHkStatus, occupied: boolean) {
  if (hk === 'OUT_OF_ORDER' || hk === 'OUT_OF_SERVICE') return hk;
  if (occupied) return hk === 'DIRTY' ? ('OCCUPIED_DIRTY' as const) : ('OCCUPIED' as const);
  return hk === 'DIRTY'
    ? ('VACANT_DIRTY' as const)
    : hk === 'INSPECTED'
      ? ('INSPECTED' as const)
      : ('VACANT_CLEAN' as const);
}
