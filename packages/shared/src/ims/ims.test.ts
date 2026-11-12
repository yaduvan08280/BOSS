import { describe, expect, it } from 'vitest';
import { adjustMachine, countMachine, poMachine } from '../machines/ims';
import { transition } from '../machines/transition';
import { addDays } from '../work/calendar';
import { DEFAULT_IMS_RULES, imsRulesSchema, moveSchema } from './rules';
import {
  averageDailyUse,
  bandOf,
  bottomByTurns,
  computeMax,
  orderDay,
  owsLine,
  parseItemRows,
  reviewItem,
  roundUpQty,
  turnsOf,
  worseBand,
  type Band,
} from './stock';

const R = DEFAULT_IMS_RULES.max;

/** 120 days of issues up to 04/11/2026: `perDay(i)` units on day i (0 = the oldest). */
function history(perDay: (i: number) => number, days = 120, asOf = '2026-11-04') {
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(asOf, -days + 1 + i),
    qty: perDay(i),
  })).filter((o) => o.qty > 0);
}

describe('the rule defaults (CLAUDE.md §10.1)', () => {
  it('match the screens', () => {
    expect(DEFAULT_IMS_RULES).toMatchObject({
      max: {
        useDays: 120,
        reviewEveryDays: 15,
        raiseAfterRedDays: 3,
        lowerWhenPurplePct: 50,
        safetyStep: 0.25,
        lowestSafety: 1,
      },
      turns: { nosTurnsBelow: 10, nosTargetPct: 50, turnsGrowthPct: 26, stopBottomPct: 20 },
      audit: { topByValue: 50, deadAfterDays: 365 },
      people: { anyOne: true, neverOwn: true, ownerAlways: true },
    });
    // A partial save keeps the other answers.
    expect(imsRulesSchema.parse({ max: { useDays: 90 } }).max).toMatchObject({
      useDays: 90,
      reviewEveryDays: 15,
    });
  });
});

describe('MAX from use history', () => {
  it('average daily use over the window, and over the tracked days for a new item', () => {
    expect(
      averageDailyUse(
        history(() => 2),
        '2026-11-04',
        120,
      ),
    ).toBe(2);
    // 10 a week (every Monday-ish: one day in seven) → 10/7 a day.
    expect(
      averageDailyUse(
        history((i) => (i % 7 === 0 ? 10 : 0)),
        '2026-11-04',
        119,
      ),
    ).toBeCloseTo(170 / 119, 5);
    // Issues older than the window don't count.
    expect(
      averageDailyUse(
        history(() => 3, 200),
        '2026-11-04',
        90,
      ),
    ).toBe(3);
    // Tracked only 30 days: 60 used → 2 a day, not 0.5.
    expect(
      averageDailyUse(
        history((i) => (i >= 90 ? 2 : 0)),
        '2026-11-04',
        120,
        addDays('2026-11-04', -29),
      ),
    ).toBe(2);
  });
  it('MAX = daily use × lead time × safety factor, rounded up, never under the minimum', () => {
    expect(computeMax(2, 10, 1.5)).toBe(30);
    expect(computeMax(1.3, 7, 1.25)).toBe(12); // 11.375 → 12
    expect(computeMax(0.01, 3, 1)).toBe(0.03);
    expect(computeMax(0.5, 10, 1, 20)).toBe(20);
    expect(roundUpQty(-1)).toBe(0);
  });
  it('the review raises the safety factor after 3 red days, lowers it when purple half the time, keeps it otherwise', () => {
    const use = averageDailyUse(
      history(() => 2),
      '2026-11-04',
      R.useDays,
    );
    const days = (red: number, purple: number): Band[] => [
      ...Array<Band>(red).fill('red'),
      ...Array<Band>(purple).fill('purple'),
      ...Array<Band>(15 - red - purple).fill('green'),
    ];
    const at = (sf: number, b: Band[]) =>
      reviewItem({ safetyFactor: sf, leadTimeDays: 10, bands: b, avgDailyUse: use, rules: R });
    expect(at(1.5, days(3, 0))).toMatchObject({ change: 'raised', safetyFactor: 1.75, max: 35 });
    expect(at(1.5, days(2, 0))).toMatchObject({ change: 'kept', safetyFactor: 1.5, max: 30 });
    // 50% of 15 days = 8 days purple.
    expect(at(1.5, days(0, 8))).toMatchObject({ change: 'lowered', safetyFactor: 1.25, max: 25 });
    expect(at(1.5, days(0, 7))).toMatchObject({ change: 'kept' });
    expect(at(1, days(0, 15))).toMatchObject({ change: 'kept', safetyFactor: 1, max: 20 });
    // Red wins over purple in the same period (running out is worse).
    expect(at(1.5, days(3, 9))).toMatchObject({ change: 'raised' });
    // Use going up moves MAX up even with the factor kept.
    const busier = averageDailyUse(
      history((i) => (i < 60 ? 1 : 3)),
      '2026-11-04',
      120,
    );
    expect(
      reviewItem({ safetyFactor: 1.5, leadTimeDays: 10, bands: days(0, 0), avgDailyUse: busier, rules: R })
        .max,
    ).toBe(30);
  });
});

describe('colour bands', () => {
  it('red under a third of MAX, yellow under two thirds, green to MAX, purple above', () => {
    expect([0, 9.9, 10, 19.9, 20, 30, 30.1].map((s) => bandOf(s, 30))).toEqual([
      'red',
      'red',
      'yellow',
      'yellow',
      'green',
      'green',
      'purple',
    ]);
    expect(bandOf(5, null)).toBe('none');
    // Under the item's minimum is red whatever MAX says.
    expect(bandOf(25, 30, 26)).toBe('red');
    expect(worseBand('green', 'red')).toBe('red');
    expect(worseBand('purple', 'yellow')).toBe('purple');
  });
});

describe('OWS (order when short)', () => {
  it('orders MAX − (stock + on order) for short items only', () => {
    expect(owsLine({ stock: 5, onOrder: 0, maxQty: 30 })).toEqual({ short: true, qty: 25, band: 'red' });
    expect(owsLine({ stock: 15, onOrder: 0, maxQty: 30 })).toMatchObject({
      short: true,
      qty: 15,
      band: 'yellow',
    });
    // Already on order: not short any more.
    expect(owsLine({ stock: 5, onOrder: 20, maxQty: 30 })).toMatchObject({ short: false, qty: 0 });
    expect(owsLine({ stock: 25, onOrder: 0, maxQty: 30 })).toMatchObject({ short: false });
    // No MAX yet but a minimum: order up to it.
    expect(owsLine({ stock: 2, onOrder: 0, maxQty: null, minQty: 10 })).toMatchObject({
      short: true,
      qty: 8,
    });
  });
  it('the list opens N days before the order day', () => {
    const ows = { orderWeekday: 1, daysAhead: 1 };
    // Wednesday 04/11/2026 → Monday 09/11, list from Sunday 08/11.
    expect(orderDay('2026-11-04', ows)).toEqual({ date: '2026-11-09', opensOn: '2026-11-08', open: false });
    expect(orderDay('2026-11-08', ows).open).toBe(true);
    expect(orderDay('2026-11-09', ows)).toMatchObject({ date: '2026-11-09', open: true });
  });
});

describe('turns, NOS and slow items', () => {
  it('turns = a year’s use ÷ average stock value; the slowest 20% are offered for stopping', () => {
    expect(turnsOf(1_20_000, 10_000)).toBe(12);
    expect(turnsOf(0, 0)).toBe(0);
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, turns: i, value: 100 }));
    expect(bottomByTurns(items, 20).map((x) => x.id)).toEqual([0, 1]);
    expect(bottomByTurns([{ id: 'none', turns: 0, value: 0 }], 20)).toEqual([]);
  });
});

describe('item import', () => {
  it('reads headings in any order, defaults the rest, and names every problem', () => {
    const rows = parseItemRows(
      [
        ['Item name', 'Code', 'Unit', 'Rate (₹)', 'Opening stock', 'Lead time'],
        ['Quartz grit 0.3mm', 'RM-001', 'kg', '42.50', '1,200', '10'],
        ['Resin', 'RM-002', '', 'abc', '', ''],
        ['Pigment', 'rm-001', 'kg', '', '', ''],
        ['', 'X', '', '', '', ''],
      ],
      new Set(['old-1']),
    );
    expect(rows[0]).toMatchObject({
      line: 2,
      code: 'RM-001',
      unit: 'kg',
      ratePaise: 4250,
      openingQty: 1200,
      leadTimeDays: 10,
      errors: [],
    });
    expect(rows[1]).toMatchObject({ unit: 'pcs', leadTimeDays: 7, errors: ['Rate must be a number'] });
    expect(rows[2]!.errors).toEqual(['The same code is in the list twice']);
    expect(rows[3]!.errors).toEqual(['Name is missing']);
    // No headings: the default column order.
    expect(parseItemRows([['OLD-1', 'Bearing 6205', 'pcs']], new Set(['old-1']))[0]!.errors).toEqual([
      'This code is already in the item master',
    ]);
  });
});

describe('moves and machines', () => {
  it('a move needs a quantity; an adjustment needs its reason; a transfer needs where to', () => {
    expect(moveSchema.safeParse({ itemId: 'i', type: 'OUT', qty: -2 }).success).toBe(false);
    expect(moveSchema.safeParse({ itemId: 'i', type: 'ADJUST', qty: -2 }).success).toBe(false);
    expect(moveSchema.safeParse({ itemId: 'i', type: 'ADJUST', qty: -2, reason: 'DAMAGED' }).success).toBe(
      true,
    );
    expect(moveSchema.safeParse({ itemId: 'i', type: 'TRANSFER', qty: 2 }).success).toBe(false);
  });
  it('purchase orders: received in parts, closed short, not cancelled once anything came in', () => {
    const t = (
      from: 'DRAFT' | 'SENT' | 'PARTLY_RECEIVED',
      action: 'send' | 'receive' | 'close' | 'cancel',
      ctx = { allIn: false, anyIn: false },
    ) => transition(poMachine, { from, action, roles: ['admin'], ctx }).to;
    expect(t('DRAFT', 'send')).toBe('SENT');
    expect(t('SENT', 'receive')).toBe('PARTLY_RECEIVED');
    expect(t('PARTLY_RECEIVED', 'receive', { allIn: true, anyIn: true })).toBe('RECEIVED');
    expect(t('PARTLY_RECEIVED', 'close')).toBe('RECEIVED');
    expect(() => t('SENT', 'cancel', { allIn: false, anyIn: true })).toThrow();
    expect(() =>
      transition(poMachine, {
        from: 'DRAFT',
        action: 'receive',
        roles: ['admin'],
        ctx: { allIn: true, anyIn: false },
      }),
    ).toThrow();
  });
  it('adjustments: never your own when the rule says so; counts are counted or skipped once', () => {
    expect(
      transition(adjustMachine, {
        from: 'PENDING',
        action: 'approve',
        roles: ['approver'],
        ctx: { own: false, neverOwn: true },
      }).to,
    ).toBe('APPLIED');
    expect(() =>
      transition(adjustMachine, {
        from: 'PENDING',
        action: 'approve',
        roles: ['approver'],
        ctx: { own: true, neverOwn: true },
      }),
    ).toThrow();
    expect(
      transition(adjustMachine, {
        from: 'PENDING',
        action: 'approve',
        roles: ['approver'],
        ctx: { own: true, neverOwn: false },
      }).to,
    ).toBe('APPLIED');
    expect(() =>
      transition(countMachine, { from: 'COUNTED', action: 'count', roles: ['auditor'], ctx: {} }),
    ).toThrow();
  });
  it('L17: a waiting line is withdrawn by the system only, and only while it waits', () => {
    const ctx = { own: false, neverOwn: true };
    const withdraw = (from: 'PENDING' | 'APPLIED' | 'REJECTED', roles: ('approver' | 'system')[]) =>
      transition(adjustMachine, { from, action: 'withdraw', roles, ctx }).to;
    expect(withdraw('PENDING', ['system'])).toBe('REJECTED');
    expect(() => withdraw('PENDING', ['approver'])).toThrow();
    expect(() => withdraw('APPLIED', ['system'])).toThrow();
    expect(() => withdraw('REJECTED', ['system'])).toThrow();
  });
});
