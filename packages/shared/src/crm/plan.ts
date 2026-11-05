import { z } from 'zod';
import { addDays, daysBetween, daysInMonth, weekdayOf } from '../work/calendar';
import { roundTo, splitExact } from './split';

/** CLAUDE.md §11.1 — the year plan's inputs. Money in paise (numbers: ₹1,000 Cr still fits exactly). */
export const ROUND_UNITS = [0, 100_000, 1_000_000, 10_000_000] as const; // none, ₹1,000, ₹10,000, ₹1 L

export const seasonsSchema = z.object({
  peakPct: z.number().min(0).max(300).default(40),
  goodPct: z.number().min(0).max(300).default(15),
  slowPct: z.number().min(-90).max(0).default(-20),
  /** Month numbers 1–12 in each season (a month in none is "normal"). */
  peak: z.array(z.number().int().min(1).max(12)).default([]),
  good: z.array(z.number().int().min(1).max(12)).default([]),
  slow: z.array(z.number().int().min(1).max(12)).default([]),
});
export type Seasons = z.infer<typeof seasonsSchema>;

const money = z.number().int().min(0).max(1e15);
const twelve = z.array(money).length(12);

export const planInputSchema = z.object({
  lastTurnover: money.default(0),
  lastGp: money.default(0),
  mode: z.enum(['growth', 'exact']).default('growth'),
  growthPct: z.number().min(-90).max(1000).default(20),
  exactTurnover: money.nullish(),
  /** Gross profit as a share of turnover this year (default: last year's margin). */
  gpMarginPct: z.number().min(0).max(100).nullish(),
  /** Growth of each quarter over the one before (Q1 is the base). */
  quarterGrowthPct: z.array(z.number().min(-90).max(500)).length(4).default([0, 0, 0, 0]),
  /** Fine-tune a quarter up or down (% of its share; the year total stays). */
  quarterTunePct: z.array(z.number().min(-90).max(500)).length(4).default([0, 0, 0, 0]),
  /** Growth from one month to the next inside a quarter. */
  monthGrowthPct: z.number().min(-50).max(100).default(0),
  /** Set once a month is changed by hand: then the months are the plan (and their sum the year). */
  months: twelve.nullish(),
  monthsGp: twelve.nullish(),
  /** Part weeks at a month's edge go into the next (or previous) full week of the same month. */
  joinPartWeeks: z.boolean().default(true),
  /** Day by day: % up or down per day of a week (keyed by the week's first day). */
  dayPct: z.record(z.string(), z.array(z.number().min(-100).max(500)).max(7)).default({}),
  seasons: seasonsSchema.default(seasonsSchema.parse({})),
  roundUnit: z.number().int().min(0).max(10_000_000).default(0),
});
export type PlanInput = z.infer<typeof planInputSchema>;
export const DEFAULT_PLAN: PlanInput = planInputSchema.parse({});

export type PlanCalendar = {
  /** First day of the FY (YYYY-04-01). */
  fyStart: string;
  holidays: Set<string>;
  workingWeekdays: Set<number>;
};

export type PlanWeek = {
  start: string;
  end: string;
  days: number;
  workingDays: number;
  holidays: number;
  turnover: number;
  gp: number;
  /** Each day of the week: its target (0 on days off). */
  daily: { date: string; working: boolean; turnover: number }[];
};
export type PlanMonth = {
  month: string;
  turnover: number;
  gp: number;
  workingDays: number;
  season: SeasonKind;
  weeks: PlanWeek[];
};
export type SeasonKind = 'peak' | 'good' | 'slow' | 'normal';
export type PlanView = {
  year: {
    turnover: number;
    gp: number;
    growthPct: number | null;
    marginPct: number;
    lastTurnover: number;
    lastGp: number;
  };
  quarters: { turnover: number; gp: number; sharePct: number }[];
  months: PlanMonth[];
  perMonth: number;
  perWeek: number;
  /** True when every level adds up exactly (always, unless a stored plan is broken). */
  addsUp: boolean;
  edited: boolean;
};

export const seasonOf = (m: number, s: Seasons): SeasonKind =>
  s.peak.includes(m) ? 'peak' : s.good.includes(m) ? 'good' : s.slow.includes(m) ? 'slow' : 'normal';
const seasonFactor = (m: number, s: Seasons) => {
  const k = seasonOf(m, s);
  return 1 + (k === 'peak' ? s.peakPct : k === 'good' ? s.goodPct : k === 'slow' ? s.slowPct : 0) / 100;
};

/** The 12 months of the FY: YYYY-MM and their days. */
export function fyMonths(fyStart: string) {
  const [y, m] = fyStart.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const mm = ((m - 1 + i) % 12) + 1;
    const yy = y + Math.floor((m - 1 + i) / 12);
    const key = `${yy}-${String(mm).padStart(2, '0')}`;
    return { key, year: yy, month: mm, first: `${key}-01`, days: daysInMonth(yy, mm) };
  });
}

const isWorking = (d: string, cal: PlanCalendar) =>
  !cal.holidays.has(d) && cal.workingWeekdays.has(weekdayOf(d));

/** The year's turnover target: last year + growth, or the exact amount; rounded to the plan's unit. */
export function yearTarget(p: PlanInput) {
  const raw = p.mode === 'exact' ? (p.exactTurnover ?? 0) : p.lastTurnover * (1 + p.growthPct / 100);
  return roundTo(Math.max(0, raw), p.roundUnit);
}
export const marginOf = (p: PlanInput) =>
  p.gpMarginPct ?? (p.lastTurnover > 0 ? Math.round((p.lastGp / p.lastTurnover) * 10000) / 100 : 0);

/** Months from the year (no hand edits): quarters by growth and tuning, months by working days × season × growth. */
export function derivedMonths(p: PlanInput, cal: PlanCalendar): number[] {
  const months = fyMonths(cal.fyStart);
  const year = yearTarget(p);
  const q = [1];
  for (let i = 1; i < 4; i++) q.push(q[i - 1]! * (1 + p.quarterGrowthPct[i]! / 100));
  // Seasons and holidays are already in each quarter's weight (its months' working days × season).
  const mw = months.map((mo, i) => {
    const working = Array.from({ length: mo.days }, (_, d) => addDays(mo.first, d)).filter((d) =>
      isWorking(d, cal),
    ).length;
    return Math.max(working, 1) * seasonFactor(mo.month, p.seasons) * (1 + p.monthGrowthPct / 100) ** (i % 3);
  });
  const qWeights = q.map(
    (g, i) => g * (1 + p.quarterTunePct[i]! / 100) * (mw[i * 3]! + mw[i * 3 + 1]! + mw[i * 3 + 2]!),
  );
  const quarters = splitExact(year, qWeights, p.roundUnit);
  return quarters.flatMap((qt, i) => splitExact(qt, mw.slice(i * 3, i * 3 + 3), p.roundUnit));
}

/** Mon–Sun weeks of a month (cut at the month's edges); part weeks join a neighbour when asked. */
export function monthWeeks(first: string, days: number, join: boolean) {
  const last = addDays(first, days - 1);
  const segs: { start: string; end: string }[] = [];
  for (let d = first; d <= last;) {
    const end = addDays(d, 7 - weekdayOf(d));
    segs.push({ start: d, end: end > last ? last : end });
    d = addDays(end, 1);
  }
  if (!join || segs.length < 2) return segs;
  const len = (s: { start: string; end: string }) => daysBetween(s.start, s.end) + 1;
  if (len(segs[0]!) < 7) segs.splice(0, 2, { start: segs[0]!.start, end: segs[1]!.end });
  if (segs.length > 1 && len(segs[segs.length - 1]!) < 7)
    segs.splice(segs.length - 2, 2, { start: segs[segs.length - 2]!.start, end: segs[segs.length - 1]!.end });
  return segs;
}

/** The whole plan, every level adding up exactly: year → quarters → months → weeks → days. */
export function buildPlan(p: PlanInput, cal: PlanCalendar): PlanView {
  const months = fyMonths(cal.fyStart);
  const turn = p.months ?? derivedMonths(p, cal);
  const yearTurnover = turn.reduce((a, b) => a + b, 0);
  const margin = marginOf(p);
  const gpYear = p.monthsGp
    ? p.monthsGp.reduce((a, b) => a + b, 0)
    : roundTo((yearTurnover * margin) / 100, p.roundUnit);
  // GP follows turnover month by month unless the months' GP was set by hand.
  const gp = p.monthsGp ?? splitExact(gpYear, turn, p.roundUnit);
  let addsUp = true;
  const view: PlanMonth[] = months.map((mo, i) => {
    const segs = monthWeeks(mo.first, mo.days, p.joinPartWeeks);
    const dates = (s: { start: string; end: string }) =>
      Array.from({ length: daysBetween(s.start, s.end) + 1 }, (_, k) => addDays(s.start, k));
    const working = segs.map((s) => dates(s).filter((d) => isWorking(d, cal)).length);
    const anyWorking = working.some((w) => w > 0);
    const wWeights = segs.map((s, k) => (anyWorking ? working[k]! : dates(s).length));
    const wTurn = splitExact(turn[i]!, wWeights, p.roundUnit);
    const wGp = splitExact(gp[i]!, wTurn.some((x) => x > 0) ? wTurn : wWeights, p.roundUnit);
    const weeks: PlanWeek[] = segs.map((s, k) => {
      const ds = dates(s);
      const pct = p.dayPct[s.start] ?? [];
      const dWeights = ds.map((d, j) =>
        isWorking(d, cal) || !anyWorking ? Math.max(0, 1 + (pct[j] ?? 0) / 100) : 0,
      );
      const dTurn = splitExact(
        wTurn[k]!,
        dWeights.some((x) => x > 0) ? dWeights : ds.map(() => 1),
        p.roundUnit,
      );
      if (dTurn.reduce((a, b) => a + b, 0) !== wTurn[k]) addsUp = false;
      return {
        start: s.start,
        end: s.end,
        days: ds.length,
        workingDays: working[k]!,
        holidays: ds.filter((d) => cal.holidays.has(d)).length,
        turnover: wTurn[k]!,
        gp: wGp[k]!,
        daily: ds.map((d, j) => ({ date: d, working: isWorking(d, cal), turnover: dTurn[j]! })),
      };
    });
    if (
      weeks.reduce((a, w) => a + w.turnover, 0) !== turn[i] ||
      weeks.reduce((a, w) => a + w.gp, 0) !== gp[i]
    )
      addsUp = false;
    return {
      month: mo.key,
      turnover: turn[i]!,
      gp: gp[i]!,
      workingDays: working.reduce((a, b) => a + b, 0),
      season: seasonOf(mo.month, p.seasons),
      weeks,
    };
  });
  const quarters = [0, 1, 2, 3].map((q) => {
    const t = turn.slice(q * 3, q * 3 + 3).reduce((a, b) => a + b, 0);
    return {
      turnover: t,
      gp: gp.slice(q * 3, q * 3 + 3).reduce((a, b) => a + b, 0),
      sharePct: yearTurnover ? Math.round((t / yearTurnover) * 1000) / 10 : 0,
    };
  });
  return {
    year: {
      turnover: yearTurnover,
      gp: gp.reduce((a, b) => a + b, 0),
      growthPct:
        p.lastTurnover > 0
          ? Math.round(((yearTurnover - p.lastTurnover) / p.lastTurnover) * 1000) / 10
          : null,
      marginPct: yearTurnover
        ? Math.round((gp.reduce((a, b) => a + b, 0) / yearTurnover) * 10000) / 100
        : margin,
      lastTurnover: p.lastTurnover,
      lastGp: p.lastGp,
    },
    quarters,
    months: view,
    perMonth: Math.round(yearTurnover / 12),
    perWeek: Math.round(yearTurnover / 52),
    addsUp: addsUp && quarters.reduce((a, q) => a + q.turnover, 0) === yearTurnover,
    edited: Boolean(p.months),
  };
}
