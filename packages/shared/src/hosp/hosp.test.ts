import { describe, expect, it } from 'vitest';
import { availableAt, parseMenuRows, priceAt, type MenuPriceLite } from './menu';
import { businessDay, discountDecision, gridSpot, hospRulesSchema, mayNc } from './setup';

describe('hospitality set-up rules (phase 14)', () => {
  it('S10: a discount within the role’s limit is allowed; above it needs an approver', () => {
    const rules = hospRulesSchema.parse({
      limits: [
        { roleId: 'steward', maxPct: 5 },
        { roleId: 'manager', maxPct: 20, maxPaise: 2000_00, nc: true },
      ],
    });
    expect(discountDecision(rules, 'steward', { pct: 5, paise: 50_00 })).toBe('allowed');
    expect(discountDecision(rules, 'steward', { pct: 10, paise: 100_00 })).toBe('needs_approval');
    expect(discountDecision(rules, 'manager', { pct: 15, paise: 1500_00 })).toBe('allowed');
    expect(discountDecision(rules, 'manager', { pct: 15, paise: 2500_00 })).toBe('needs_approval');
    // A role with no limit gives nothing by itself.
    expect(discountDecision(rules, 'cashier', { pct: 1, paise: 10_00 })).toBe('needs_approval');
    expect([mayNc(rules, 'manager'), mayNc(rules, 'steward')]).toEqual([true, false]);
  });

  it('S11: the business day runs to the cut-off', () => {
    expect(businessDay('2026-11-14', 90, 240)).toBe('2026-11-13');
    expect(businessDay('2026-11-14', 240, 240)).toBe('2026-11-14');
    expect(businessDay('2026-03-01', 0, 240)).toBe('2026-02-28');
    expect(businessDay('2026-11-14', 5, 0)).toBe('2026-11-14');
  });

  it('S14: availability windows and prices per outlet and time band', () => {
    const breakfast = [{ fromMin: 7 * 60, toMin: 10 * 60 + 30, days: [] }];
    expect([
      availableAt(breakfast, 8 * 60, 3),
      availableAt(breakfast, 11 * 60, 3),
      availableAt([], 0, 1),
    ]).toEqual([true, false, true]);
    // A late-night window on Friday and Saturday that crosses midnight: Sunday 00:30 is still Saturday's.
    const late = [{ fromMin: 22 * 60, toMin: 60, days: [5, 6] }];
    expect([
      availableAt(late, 23 * 60, 5),
      availableAt(late, 30, 7),
      availableAt(late, 30, 5),
      availableAt(late, 23 * 60, 7),
    ]).toEqual([true, true, false, false]);
    const happy = { fromMin: 17 * 60, toMin: 19 * 60, days: [] };
    const prices: MenuPriceLite[] = [
      { variantKey: '', outletId: 'pool', window: null, price: 500_00 },
      { variantKey: '', outletId: null, window: happy, price: 300_00, label: 'Happy hour' },
      { variantKey: '', outletId: 'pool', window: happy, price: 350_00, label: 'Happy hour' },
      { variantKey: 'large', outletId: null, window: null, price: 650_00 },
    ];
    const at = (outletId: string | null, minuteOfDay: number, variantKey?: string) =>
      priceAt(450_00, prices, { outletId, minuteOfDay, weekday: 2, variantKey }).price;
    expect([at('bar', 12 * 60), at('pool', 12 * 60), at('bar', 18 * 60), at('pool', 18 * 60)]).toEqual([
      450_00, 500_00, 300_00, 350_00,
    ]);
    expect(at('bar', 12 * 60, 'large')).toBe(650_00);
    expect(priceAt(450_00, prices, { outletId: 'bar', minuteOfDay: 18 * 60, weekday: 2 }).label).toBe(
      'Happy hour',
    );
  });

  it('S16: a pasted menu becomes rows, with problems named by line; bulk tables land on a grid', () => {
    const { rows, problems } = parseMenuRows(
      [
        'Category, Name, Price, Diet, Variants',
        'Starters, Paneer tikka, 320, veg, Half=180|Full=320',
        'Mains, Butter chicken, 480, non-veg',
        'Mains, , 100',
        'Bar, Whisky, abc',
        'Bar, Rum, 200, veg, Large',
      ].join('\n'),
    );
    expect(rows).toEqual([
      {
        line: 2,
        category: 'Starters',
        name: 'Paneer tikka',
        price: 320_00,
        diet: 'VEG',
        variants: [
          { name: 'Half', price: 180_00 },
          { name: 'Full', price: 320_00 },
        ],
      },
      { line: 3, category: 'Mains', name: 'Butter chicken', price: 480_00, diet: 'NONVEG', variants: [] },
    ]);
    expect(problems.map((p) => p.line)).toEqual([4, 5, 6]);
    expect([gridSpot(0), gridSpot(5), gridSpot(6), gridSpot(19)]).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 4 },
      { x: 4, y: 12 },
    ]);
  });
});
