import { describe, expect, it } from 'vitest';
import { leadMachine, planMachine } from '../machines/crm';
import { transition } from '../machines/transition';
import { addDays, weekdayOf } from '../work/calendar';
import { DEFAULT_CRM_CONFIG, seatTargets, type CrmConfig } from './config';
import {
  buildPlan,
  DEFAULT_PLAN,
  monthWeeks,
  planInputSchema,
  yearTarget,
  type PlanCalendar,
  type PlanInput,
} from './plan';
import { ageBucket, autoTags, scotOf, type CustomerStats } from './scot';
import { setPart, splitExact, splitGrid } from './split';

/** A small seeded random generator: the same "random" cases on every run. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const CR = 1_00_00_000_00; // ₹1 crore in paise
const LAKH = 1_00_000_00;

/** FY 2026-27, Sundays off, a few holidays. */
const CAL: PlanCalendar = {
  fyStart: '2026-04-01',
  holidays: new Set(['2026-08-15', '2026-10-20', '2026-11-08', '2027-01-26', '2027-03-04']),
  workingWeekdays: new Set([1, 2, 3, 4, 5, 6]),
};
const plan = (p: Partial<PlanInput> = {}) => planInputSchema.parse({ ...DEFAULT_PLAN, ...p });

describe('exact split (properties)', () => {
  it('always adds up to the total, never negative, each part within a unit of its fair share', () => {
    const r = rng(42);
    for (let k = 0; k < 3000; k++) {
      const n = 1 + Math.floor(r() * 14);
      const unit = [1, 100, 100_000, 1_000_000, 10_000_000][Math.floor(r() * 5)]!;
      const total = Math.floor(r() * 50 * CR);
      const weights = Array.from({ length: n }, () => (r() < 0.15 ? 0 : r() * 10));
      const parts = splitExact(total, weights, unit);
      expect(sum(parts)).toBe(total);
      expect(parts.every((p) => p >= 0 && Number.isInteger(p))).toBe(true);
      const W = sum(weights);
      const extra = total % unit;
      parts.forEach((p, i) => {
        const fair = W > 0 ? (total * weights[i]!) / W : total / n;
        expect(Math.abs(p - fair)).toBeLessThanOrEqual(unit + extra + 1);
      });
    }
  });
  it('parts are whole units; what a unit cannot hold goes to the biggest part', () => {
    expect(splitExact(1_000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(splitExact(1_050, [1, 3], 100)).toEqual([300, 750]);
    expect(splitExact(10, [0, 0])).toEqual([5, 5]);
    expect(() => splitExact(-1, [1])).toThrow();
  });
  it('changing one part keeps the total (or moves it), exactly', () => {
    const r = rng(7);
    for (let k = 0; k < 500; k++) {
      const parts = Array.from({ length: 12 }, () => Math.floor(r() * CR));
      const i = Math.floor(r() * 12);
      const v = Math.floor(r() * sum(parts));
      const kept = setPart(parts, i, v, true);
      expect(sum(kept)).toBe(sum(parts));
      expect(kept[i]).toBe(v);
      const moved = setPart(parts, i, v, false);
      expect(sum(moved)).toBe(sum(parts) - parts[i]! + v);
    }
  });
});

describe('the year plan', () => {
  it('₹5 Cr last year + 50% = ₹7.5 Cr, every level adding up to the rupee', () => {
    const v = buildPlan(plan({ lastTurnover: 5 * CR, lastGp: CR, growthPct: 50 }), CAL);
    expect(v.year.turnover).toBe(7.5 * CR);
    expect(v.year.marginPct).toBe(20);
    expect(v.year.gp).toBe(1.5 * CR);
    expect(sum(v.quarters.map((q) => q.turnover))).toBe(7.5 * CR);
    expect(sum(v.months.map((m) => m.turnover))).toBe(7.5 * CR);
    for (const m of v.months) {
      expect(sum(m.weeks.map((w) => w.turnover))).toBe(m.turnover);
      expect(sum(m.weeks.map((w) => w.gp))).toBe(m.gp);
      for (const w of m.weeks) expect(sum(w.daily.map((d) => d.turnover))).toBe(w.turnover);
      // Holidays and Sundays get nothing.
      for (const w of m.weeks) for (const d of w.daily) if (!d.working) expect(d.turnover).toBe(0);
    }
    expect(v.addsUp).toBe(true);
  });
  it('random plans always add up (seasons, growth, tuning, rounding, day weights)', () => {
    const r = rng(2026);
    for (let k = 0; k < 120; k++) {
      const months = Array.from({ length: 12 }, (_, i) => i + 1);
      const pick = () => months.filter(() => r() < 0.25);
      const p = plan({
        lastTurnover: Math.floor(r() * 20 * CR),
        lastGp: Math.floor(r() * 4 * CR),
        growthPct: Math.round(r() * 120 - 10),
        quarterGrowthPct: [0, r() * 30, r() * 30, r() * 30],
        quarterTunePct: [r() * 20 - 10, 0, r() * 20 - 10, 0],
        monthGrowthPct: r() * 10,
        joinPartWeeks: r() < 0.5,
        roundUnit: [0, 100_000, 1_000_000, 10_000_000][Math.floor(r() * 4)]!,
        seasons: { peakPct: 40, goodPct: 15, slowPct: -20, peak: pick(), good: pick(), slow: pick() },
        dayPct: { '2026-10-05': [10, 0, -10, 20, 0, 5, 0] },
      });
      const v = buildPlan(p, CAL);
      expect(v.addsUp).toBe(true);
      expect(v.year.turnover).toBe(yearTarget(p));
      expect(sum(v.months.map((m) => m.turnover))).toBe(v.year.turnover);
      expect(sum(v.months.map((m) => m.gp))).toBe(v.year.gp);
      if (p.roundUnit > 1) for (const m of v.months) expect(m.turnover % p.roundUnit).toBe(0);
    }
  });
  it('quarters grow over the one before; seasons lift their months', () => {
    const v = buildPlan(
      plan({ mode: 'exact', exactTurnover: 12 * CR, quarterGrowthPct: [0, 10, 10, 10] }),
      CAL,
    );
    const q = v.quarters.map((x) => x.turnover);
    expect(q[1]! > q[0]! && q[2]! > q[1]! && q[3]! > q[2]!).toBe(true);
    const s = buildPlan(
      plan({
        mode: 'exact',
        exactTurnover: 12 * CR,
        seasons: { peakPct: 40, goodPct: 15, slowPct: -20, peak: [10], good: [], slow: [7] },
      }),
      CAL,
    );
    const oct = s.months.find((m) => m.month === '2026-10')!;
    const jul = s.months.find((m) => m.month === '2026-07')!;
    expect(oct.season).toBe('peak');
    expect(oct.turnover).toBeGreaterThan(jul.turnover);
  });
  it('a month changed by hand: keep the year (others adjust) or change it', () => {
    const p = plan({ lastTurnover: 5 * CR, lastGp: CR, growthPct: 50 });
    const base = buildPlan(p, CAL);
    const turn = base.months.map((m) => m.turnover);
    const keep = buildPlan({ ...p, months: setPart(turn, 6, 95 * LAKH, true) }, CAL);
    expect(keep.months[6]!.turnover).toBe(95 * LAKH);
    expect(keep.year.turnover).toBe(7.5 * CR);
    expect(keep.edited).toBe(true);
    const change = buildPlan({ ...p, months: setPart(turn, 6, 95 * LAKH, false) }, CAL);
    expect(change.year.turnover).toBe(7.5 * CR - turn[6]! + 95 * LAKH);
    expect(change.addsUp).toBe(true);
  });
  it('weeks run Monday to Sunday; part weeks at the edges join a neighbour', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const cut = monthWeeks('2026-10-01', 31, false);
    expect(cut[0]).toEqual({ start: '2026-10-01', end: '2026-10-04' });
    expect(cut.every((w) => weekdayOf(w.start) === 1 || w.start === '2026-10-01')).toBe(true);
    const joined = monthWeeks('2026-10-01', 31, true);
    expect(joined[0]).toEqual({ start: '2026-10-01', end: '2026-10-11' });
    expect(joined[joined.length - 1]!.end).toBe('2026-10-31');
    expect(joined.length).toBe(cut.length - 2);
  });
});

describe('seat targets and the science check', () => {
  const cfg = (c: Partial<CrmConfig>): CrmConfig => ({ ...DEFAULT_CRM_CONFIG, ...c });
  it('CRR / NBD split, the owner out of CRR, each person by month, all adding up', () => {
    const months = buildPlan(plan({ mode: 'exact', exactTurnover: 7.5 * CR }), CAL).months.map(
      (m) => m.turnover,
    );
    const t = seatTargets(
      months,
      cfg({
        seats: { owner: ['o'], crrSc: ['a'], osr: ['b'], nbdSc: ['c'], salesRep: ['d', 'e'], crm: ['f'] },
        split: { crrPct: 50, gpFollows: true, ownerAmount: CR, seatWeights: {} },
      }),
    );
    expect([t.crr, t.nbd]).toEqual([3.75 * CR, 3.75 * CR]);
    expect(t.rows.find((r) => r.seat === 'owner')!.year).toBe(CR);
    expect(sum(t.rows.map((r) => r.year))).toBe(7.5 * CR);
    for (const r of t.rows) expect(sum(r.months)).toBe(r.year);
    for (let m = 0; m < 12; m++) expect(sum(t.rows.map((r) => r.months[m]!))).toBe(months[m]);
    expect(t.warnings).toEqual([]);
  });
  it('a table adds up both ways (properties)', () => {
    const r = rng(9);
    for (let k = 0; k < 400; k++) {
      const cols = Array.from({ length: 12 }, () => Math.floor(r() * CR));
      const rowsW = Array.from({ length: 1 + Math.floor(r() * 8) }, () => r());
      const rows = splitExact(sum(cols), rowsW);
      const t = splitGrid(rows, cols);
      t.forEach((row, i) => expect(sum(row)).toBe(rows[i]));
      for (let c = 0; c < 12; c++) expect(sum(t.map((row) => row[c]!))).toBe(cols[c]);
      expect(t.flat().every((x) => x >= 0)).toBe(true);
    }
  });
  it('names what doesn’t hold: empty seats, the owner over CRR, no lead sources', () => {
    const t = seatTargets(
      [CR, ...Array(11).fill(0)],
      cfg({
        seats: {},
        split: { crrPct: 40, gpFollows: true, ownerAmount: CR, seatWeights: {} },
        nbd: { ...DEFAULT_CRM_CONFIG.nbd, sources: [] },
      }),
    );
    expect(t.warnings.map((w) => w.code).sort()).toEqual(
      ['emptySeat', 'emptySeat', 'emptySeat', 'noLeadSources', 'noOwner', 'ownerOverCrr'].sort(),
    );
    expect(sum(t.rows.map((r) => r.year))).toBe(CR);
  });
});

describe('SCOT', () => {
  const every = (start: string, gap: number, n: number, amount = 10_000_00) =>
    Array.from({ length: n }, (_, i) => ({
      date: addDays(start, i * gap),
      amount,
      items: i % 2 ? ['Valves'] : ['Valves', 'Packing material'],
    }));
  it('Ram: every 20 days → due 20 days after the last, call 5 days before', () => {
    const s = scotOf(every('2026-07-01', 20, 6), '2026-11-04', { callBeforeDays: 5 });
    expect(s).toMatchObject({
      onScot: true,
      everyDays: 20,
      rhythm: 'fortnightly',
      lastOrder: '2026-10-09',
      nextDue: '2026-10-29',
      callOn: '2026-10-24',
      averageOrder: 10_000_00,
    });
    expect(s.topItems).toEqual(['Valves', 'Packing material']);
  });
  it('a usual date of the month: due on that date, called before it, moved off a Sunday', () => {
    const orders = ['2026-06-10', '2026-07-11', '2026-08-09', '2026-09-10', '2026-10-10'].map((date) => ({
      date,
      amount: 50_000_00,
    }));
    const s = scotOf(orders, '2026-10-20', { callBeforeDays: 5 });
    expect(s).toMatchObject({ usualDay: 10, rhythm: 'monthly', nextDue: '2026-11-10', callOn: '2026-11-05' });
    // 05/11/2026 is a Thursday; with Thursdays off it moves back to Wednesday.
    const off = scotOf(orders, '2026-10-20', { callBeforeDays: 5, isWorking: (d) => weekdayOf(d) !== 4 });
    expect(off.callOn).toBe('2026-11-04');
  });
  it('one order is not a rhythm; orders older than a year don’t count', () => {
    expect(scotOf([{ date: '2026-10-01', amount: 1 }], '2026-11-04', { callBeforeDays: 5 }).onScot).toBe(
      false,
    );
    expect(scotOf(every('2025-01-01', 30, 3), '2026-11-04', { callBeforeDays: 5 }).onScot).toBe(false);
  });
});

describe('customer tags and ageing', () => {
  const c = (
    id: string,
    sales: number,
    gp: number,
    last: string | null,
    extra: Partial<CustomerStats> = {},
  ): CustomerStats => ({
    id,
    sales12: sales,
    gp12: gp,
    orders: 5,
    firstOrder: '2026-01-01',
    lastOrder: last,
    createdOn: '2025-12-01',
    payDelayDays: 0,
    creditDays: 30,
    lostAt: null,
    owners: false,
    ...extra,
  });
  const rules = {
    newOrders: 3,
    newDays: 90,
    newRule: 'first' as const,
    sleepingDays: 60,
    lostDays: 180,
    vampire: true,
  };
  it('top / bottom 20% by GP, sleeping after 60 days, lost after 180, new, vampire, owner’s', () => {
    const all = [
      c('a', 100, 30, '2026-11-01', { owners: true }),
      c('b', 90, 5, '2026-10-30', { payDelayDays: 25 }),
      c('c', 50, 10, '2026-08-15'),
      c('d', 40, 8, '2026-05-01'),
      c('e', 10, 1, '2026-10-01', { orders: 1, firstOrder: '2026-10-01' }),
    ];
    const t = autoTags(all, '2026-11-04', rules);
    expect(t.get('a')).toEqual(['top20', 'owners']);
    expect(t.get('b')).toEqual(['middle', 'vampire']);
    expect(t.get('c')).toEqual(['middle', 'sleeping']);
    expect(t.get('d')).toEqual(['middle', 'lost']);
    expect(t.get('e')).toEqual(['bottom20', 'new']);
  });
  it('ageing by days past due', () => {
    expect(
      ['2026-11-10', '2026-10-01', '2026-09-01', '2026-08-01', '2026-06-01'].map((d) =>
        ageBucket(d, '2026-11-04'),
      ),
    ).toEqual(['0_30', '31_60', '61_90', '90_plus', '90_plus']);
  });
});

describe('machines', () => {
  it('plan: draft → for approval → approved by the owner → unlocked back to draft', () => {
    const t = (
      from: 'DRAFT' | 'PENDING' | 'APPROVED',
      action: 'submit' | 'approve' | 'reject' | 'withdraw' | 'unlock',
      role: 'editor' | 'owner',
    ) => transition(planMachine, { from, action, roles: [role], ctx: {} }).to;
    expect(t('DRAFT', 'submit', 'editor')).toBe('PENDING');
    expect(() => t('PENDING', 'approve', 'editor')).toThrow();
    expect(t('PENDING', 'approve', 'owner')).toBe('APPROVED');
    expect(t('APPROVED', 'unlock', 'editor')).toBe('DRAFT');
    expect(() => t('APPROVED', 'submit', 'owner')).toThrow();
  });
  it('lead: enquiry → qualified → won; lost and not-qualified can be reopened', () => {
    const t = (
      from: 'ENQUIRY' | 'OPEN' | 'WON' | 'LOST' | 'NOT_QUALIFIED',
      action: 'qualify' | 'disqualify' | 'move' | 'win' | 'lose' | 'reopen',
    ) => transition(leadMachine, { from, action, roles: ['sales'], ctx: {} }).to;
    expect(t('ENQUIRY', 'qualify')).toBe('OPEN');
    expect(t('OPEN', 'win')).toBe('WON');
    expect(t('LOST', 'reopen')).toBe('ENQUIRY');
    expect(() => t('WON', 'reopen')).toThrow();
  });
});
