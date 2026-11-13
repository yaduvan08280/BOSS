import { z } from 'zod';
import { overrideOf } from '../hr/rules';

/**
 * Phase 16 — table reservations, the waitlist and guest profiles (shared schemas and pure rules): an outlet's
 * booking rules, the slots of a day, how long a party stays, which table(s) fit a party, the deposit a large
 * party owes and what happens to it, and the wait quoted to a walk-in.
 */
const id = z.string().min(1).max(40);
const minute = z.number().int().min(0).max(2880);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Indian mobiles are stored E.164; ten digits are taken as +91. */
export const guestMobile = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s\-()]/g, ''))
  .transform((s) => (/^\d{10}$/.test(s) ? `+91${s}` : s.startsWith('+') ? s : `+${s}`))
  .refine((s) => /^\+\d{8,15}$/.test(s), 'Enter the mobile number with its country code');

export const RESERVATION_SOURCES = ['PHONE', 'WALK_IN', 'ONLINE'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];
export const DEPOSIT_RULES = ['KEEP', 'REFUND'] as const;

/** An outlet's booking rules. Every part has a default, so an outlet takes bookings as soon as it has tables. */
export const bookingSchema = z.object({
  /** The public booking page is open. */
  online: z.boolean().default(false),
  /** An online booking is confirmed at once (unless a deposit is due); off, staff confirm each one. */
  autoConfirm: z.boolean().default(true),
  slotMin: z.number().int().min(5).max(120).default(30),
  /** How long a party keeps its table: the first row whose `upTo` holds the party. */
  durations: z
    .array(z.object({ upTo: z.number().int().min(1).max(500), minutes: z.number().int().min(15).max(600) }))
    .min(1)
    .max(10)
    .default([
      { upTo: 2, minutes: 90 },
      { upTo: 4, minutes: 120 },
      { upTo: 8, minutes: 150 },
      { upTo: 500, minutes: 180 },
    ]),
  /** First and last seating (minutes from midnight); left out, the outlet's opening hours. */
  fromMin: minute.nullish(),
  toMin: minute.nullish(),
  aheadDays: z.number().int().min(0).max(365).default(30),
  /** The largest party the public page takes; larger ones are asked to call. */
  maxOnline: z.number().int().min(1).max(500).default(8),
  /** Parties of this size and more pay a deposit (0 = nobody does). */
  depositFrom: z.number().int().min(0).max(500).default(0),
  depositPerHeadPaise: z.number().int().min(0).max(1e9).default(0),
  /** A table is held this long after its time; then the booking is a no-show. */
  holdMin: z.number().int().min(0).max(240).default(15),
  reminderHours: z.number().min(0).max(72).default(3),
  /** A deposit comes back when the booking is cancelled at least this long before its time. */
  cancelFreeHours: z.number().min(0).max(240).default(4),
  noShowDeposit: z.enum(DEPOSIT_RULES).default('KEEP'),
  /** The floor shows a table as reserved from this long before its booking. */
  floorHoldMin: z.number().int().min(0).max(240).default(30),
});
export type Booking = z.infer<typeof bookingSchema>;
export const DEFAULT_BOOKING: Booking = bookingSchema.parse({});
/** A change to the rules carries no defaults: only what is sent changes (decision 71). */
export const bookingPatchSchema = overrideOf(bookingSchema);

export const guestSchema = z.object({
  mobile: guestMobile,
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(120).nullish(),
  /** Day and month matter; the year may be 0000 when the guest did not say. */
  birthday: day.nullish(),
  anniversary: day.nullish(),
  allergies: z.string().trim().max(300).nullish(),
  preferences: z.string().trim().max(300).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
});
export const guestPatchSchema = guestSchema
  .omit({ tags: true })
  .partial()
  .extend({
    tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  });
export const CONSENT_SOURCES = ['STAFF', 'ONLINE', 'GUEST'] as const;
export const consentSchema = z.object({
  marketing: z.boolean(),
  /** How the guest said so: told a member of staff, ticked the box online, or asked in writing. */
  source: z.enum(CONSENT_SOURCES).default('STAFF'),
  note: z.string().trim().max(200).nullish(),
});
export type Consent = {
  marketing: boolean;
  source: string;
  at: string;
  byId: string | null;
  note?: string | null;
};

const guestIn = z.object({
  mobile: guestMobile,
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(120).nullish(),
});
export const reservationSchema = z.object({
  outletId: id,
  day,
  /** Minutes from the day's midnight (past 1440 = after midnight, still that evening's service). */
  startMin: minute,
  partySize: z.number().int().min(1).max(500),
  guest: guestIn,
  /** Left out, MONO picks the best fit. */
  tableIds: z.array(id).max(12).optional(),
  durationMin: z.number().int().min(15).max(600).optional(),
  occasion: z.string().trim().max(60).nullish(),
  requests: z.string().trim().max(500).nullish(),
  note: z.string().trim().max(500).nullish(),
  source: z.enum(RESERVATION_SOURCES).default('PHONE'),
});
export const reservationPatchSchema = z.object({
  day: day.optional(),
  startMin: minute.optional(),
  partySize: z.number().int().min(1).max(500).optional(),
  tableIds: z.array(id).max(12).optional(),
  durationMin: z.number().int().min(15).max(600).optional(),
  occasion: z.string().trim().max(60).nullish(),
  requests: z.string().trim().max(500).nullish(),
  note: z.string().trim().max(500).nullish(),
});
export const waitlistSchema = z.object({
  outletId: id,
  partySize: z.number().int().min(1).max(500),
  name: z.string().trim().min(1).max(80),
  mobile: guestMobile.nullish(),
  note: z.string().trim().max(300).nullish(),
});

/** How long a party of this size keeps its table. */
export function durationFor(b: Pick<Booking, 'durations'>, size: number): number {
  const rows = [...b.durations].sort((x, y) => x.upTo - y.upTo);
  return (rows.find((r) => size <= r.upTo) ?? rows[rows.length - 1]!).minutes;
}

/**
 * The start times offered on a day, in minutes from that day's midnight. An outlet that closes after midnight
 * (18:00–01:00) gives slots past 1440; the last seating is one slot before closing unless the rules say otherwise.
 */
export function slotsOf(
  b: Pick<Booking, 'slotMin' | 'fromMin' | 'toMin'>,
  openMin: number,
  closeMin: number,
): number[] {
  const from = b.fromMin ?? openMin;
  let to = b.toMin ?? closeMin - b.slotMin;
  if (b.toMin == null && closeMin <= openMin) to += 1440;
  if (to < from) to += 1440;
  const out: number[] = [];
  for (let m = from; m <= to && out.length < 400; m += b.slotMin) out.push(m);
  return out;
}

export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd;

export type FitTable = { id: string; name: string; seats: number; combinable: boolean; floorId: string };
/**
 * The table(s) for a party: the smallest free table that seats it; else joinable free tables of one floor put
 * together — the fewest tables, then the fewest spare seats. Null when nothing fits.
 */
export function fitTables(tables: FitTable[], size: number, busy: ReadonlySet<string>): string[] | null {
  const free = tables
    .filter((t) => !busy.has(t.id))
    .sort((a, b) => a.seats - b.seats || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const single = free.find((t) => t.seats >= size);
  if (single) return [single.id];
  const found: { ids: string[]; spare: number }[] = [];
  for (const floorId of new Set(free.map((t) => t.floorId))) {
    const pool = free.filter((t) => t.combinable && t.floorId === floorId).slice(-16);
    const pick = (count: number, start: number, chosen: FitTable[], seats: number) => {
      if (chosen.length === count) {
        if (seats >= size) found.push({ ids: chosen.map((t) => t.id), spare: seats - size });
        return;
      }
      for (let i = start; i < pool.length; i++)
        pick(count, i + 1, [...chosen, pool[i]!], seats + pool[i]!.seats);
    };
    for (let count = 2; count <= Math.min(4, pool.length); count++) pick(count, 0, [], 0);
  }
  found.sort((a, b) => a.ids.length - b.ids.length || a.spare - b.spare);
  return found[0]?.ids ?? null;
}

/** What a party of this size must pay to hold its table (0 = nothing). */
export const depositFor = (b: Pick<Booking, 'depositFrom' | 'depositPerHeadPaise'>, size: number) =>
  b.depositFrom > 0 && size >= b.depositFrom ? size * b.depositPerHeadPaise : 0;

/** A paid deposit when the booking ends without a meal: cancelled in time it comes back; a no-show follows the rule. */
export function depositOutcome(
  b: Pick<Booking, 'cancelFreeHours' | 'noShowDeposit'>,
  how: 'CANCEL' | 'NO_SHOW',
  hoursBefore: number,
): 'REFUND' | 'KEEP' {
  if (how === 'NO_SHOW') return b.noShowDeposit;
  return hoursBefore >= b.cancelFreeHours ? 'REFUND' : 'KEEP';
}

/**
 * The wait to quote a walk-in: when the table it needs comes free. `freeAt` is when each table that seats the
 * party is expected to be free (now, for an empty one); `ahead` parties are already waiting for the same tables;
 * a table that has turned once takes `turnMin` to turn again. Rounded up to 5 minutes; 0 = seat them now.
 */
export function quoteWait(now: number, freeAt: number[], ahead: number, turnMin: number): number | null {
  if (!freeAt.length) return null;
  const queue = freeAt.map((t) => Math.max(t, now)).sort((a, b) => a - b);
  let at = queue[0]!;
  for (let i = 0; i <= ahead; i++) {
    at = queue.shift()!;
    queue.push(at + turnMin * 60_000);
    queue.sort((a, b) => a - b);
  }
  return Math.ceil(Math.max(0, at - now) / 300_000) * 5;
}

/** "19:30" for a slot; a slot after midnight reads as its clock time. */
export const slotLabel = (min: number) =>
  `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
