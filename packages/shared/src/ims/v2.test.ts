import { describe, expect, it } from 'vitest';
import { closingCountMachine, productionMachine, transferMachine } from '../machines/stock';
import { transition } from '../machines/transition';
import { boardPrice, pickPrice, rateOnBoard, type PriceListLite } from './pricing';
import { costOf, explode, foodCostPct, type RecipeItem, type RecipeOf } from './recipe';
import {
  averageRate,
  daysToExpiry,
  fifoValue,
  fromStockQty,
  pickFefo,
  toStockQty,
  varianceOf,
  wholeAndOpen,
} from './units';

const whisky = {
  unit: 'ml',
  units: [
    { unit: 'bottle', factor: 750 },
    { unit: 'case', factor: 9000 },
    { unit: 'peg', factor: 30 },
  ],
};

describe('inventory v2 rules (phase 13)', () => {
  it('I3: a quantity in any of the item’s units is kept in the stock unit', () => {
    expect(toStockQty(whisky, 1, 'case')).toBe(9000);
    expect(toStockQty(whisky, 2, 'Bottle')).toBe(1500);
    expect(toStockQty(whisky, 60)).toBe(60);
    expect(fromStockQty(whisky, 9000, 'bottle')).toBe(12);
    expect(() => toStockQty(whisky, 1, 'crate')).toThrow('UNKNOWN_UNIT');
    expect(toStockQty({ unit: 'g', units: [{ unit: 'sack', factor: 25000 }] }, 2, 'sack')).toBe(50000);
  });

  it('I25: bottles and the open bottle in ml', () => {
    expect(wholeAndOpen(9000 - 60 * 5 - 30, 750)).toEqual({ whole: 11, open: 420 });
    expect(wholeAndOpen(1500, 750)).toEqual({ whole: 2, open: 0 });
  });

  it('I5: first expired first out; an expired batch is never picked', () => {
    const batches = [
      { batchId: 'late', qty: 10, expiry: '2027-03-01' },
      { batchId: 'soon', qty: 4, expiry: '2026-12-01' },
      { batchId: 'dead', qty: 50, expiry: '2026-11-01' },
      { batchId: 'none', qty: 5, expiry: null },
    ];
    expect(pickFefo(batches, 6, '2026-11-13')).toEqual({
      picks: [
        { batchId: 'soon', qty: 4 },
        { batchId: 'late', qty: 2 },
      ],
      short: 0,
      expired: 50,
    });
    // Everything usable is 19; the expired 50 does not help.
    expect(pickFefo(batches, 25, '2026-11-13').short).toBe(6);
    // The day it expires it can still be used.
    expect(pickFefo(batches, 1, '2026-12-01').picks[0]).toEqual({ batchId: 'soon', qty: 1 });
    expect(daysToExpiry('2026-12-01', '2026-11-13')).toBe(18);
    expect(daysToExpiry('2026-11-01', '2026-11-13')).toBe(-12);
  });

  it('I27: weighted average and FIFO value', () => {
    // 10 at ₹100, then 10 at ₹120 → ₹110 each.
    expect(averageRate(10, 10 * 100_00, 10, 120_00)).toBe(110_00);
    expect(averageRate(0, 0, 5, 80_00)).toBe(80_00);
    // 12 left of those 20: FIFO keeps the newest 10 at 120 and 2 at 100.
    expect(
      fifoValue(
        [
          { qty: 10, rate: 120_00 },
          { qty: 10, rate: 100_00 },
        ],
        12,
      ),
    ).toBe(10 * 120_00 + 2 * 100_00);
    expect(fifoValue([{ qty: 3, rate: 50_00 }], 5, 40_00)).toBe(3 * 50_00 + 2 * 40_00);
  });

  it('I23: a count against the system gives the variance, flagged above the limit', () => {
    expect(varianceOf(8670, 8600, 330, 5)).toEqual({ diff: -70, pct: 21.2, flagged: true });
    expect(varianceOf(100, 99, 50, 5)).toEqual({ diff: -1, pct: 2, flagged: false });
    expect(varianceOf(10, 10, 0, 5)).toEqual({ diff: 0, pct: 0, flagged: false });
    expect(varianceOf(10, 8, 0, 5).flagged).toBe(true);
  });

  const item = (
    id: string,
    unit: string,
    made: RecipeItem['made'],
    rate: number,
    units = [] as RecipeItem['units'],
  ) => [id, { id, unit, made, rate, units }] as const;
  const items = new Map<string, RecipeItem>([
    item('paneer', 'g', 'BUY', 40), // 40 paise a gram
    item('onion', 'g', 'BUY', 4),
    item('cream', 'ml', 'BUY', 30),
    item('gravy', 'ml', 'DISH', 0),
    item('butter-paneer', 'plate', 'DISH', 0),
    item('whisky', 'ml', 'BUY', 200, whisky.units),
    item('peg60', 'peg', 'DISH', 0),
  ]);
  const line = (itemId: string, qty: number, more: object = {}) => ({
    itemId,
    qty,
    yieldPct: 100,
    wastagePct: 0,
    ...more,
  });
  const recipes = new Map<string, RecipeOf>([
    // 1 litre of gravy: 850 g of usable onion (85 % yield → 1000 g bought) and 200 ml cream.
    ['gravy', { outputQty: 1000, lines: [line('onion', 850, { yieldPct: 85 }), line('cream', 200)] }],
    // A plate: 150 g paneer with 4 % lost at the pass, 200 ml gravy.
    ['butter-paneer', { outputQty: 1, lines: [line('paneer', 150, { wastagePct: 4 }), line('gravy', 200)] }],
    ['peg60', { outputQty: 1, lines: [line('whisky', 2, { unit: 'peg' })] }],
  ]);

  it('I7, I8: a recipe opens its sub-recipes, with yield and wastage, to stocked ingredients', () => {
    const need = explode({ items, recipes }, 'butter-paneer', 10);
    expect(Object.fromEntries(need)).toEqual({ paneer: 1560, onion: 2000, cream: 400 });
    // A peg of 60 ml is two 30 ml pegs of the bottle.
    expect(Object.fromEntries(explode({ items, recipes }, 'peg60', 5))).toEqual({ whisky: 300 });
    expect(() => explode({ items, recipes }, 'paneer', 1)).toThrow('NO_RECIPE');
    const loop = new Map(recipes).set('gravy', { outputQty: 1, lines: [line('butter-paneer', 1)] });
    expect(() => explode({ items, recipes: loop }, 'butter-paneer', 1)).toThrow('RECIPE_LOOP');
  });

  it('I8: recipe cost from the latest rates and food cost %', () => {
    // gravy per ml = (1000 g × 4 + 200 ml × 30) / 1000 = 10 paise; plate = 156 × 40 + 200 × 10 = 8240.
    expect(costOf({ items, recipes }, 'gravy')).toBe(10);
    expect(costOf({ items, recipes }, 'butter-paneer')).toBe(8240);
    expect(foodCostPct(8240, 320_00)).toBe(25.8);
    expect(foodCostPct(8240, null)).toBeNull();
    expect(costOf({ items, recipes }, 'paneer')).toBe(40);
  });

  it('U27: the most specific price list wins; U28: a rate-board piece is priced by weight', () => {
    const list = (
      id: string,
      partyKind: string | null,
      branchId: string | null,
      from: string,
      price: number,
      to: string | null = null,
    ): PriceListLite => ({ id, partyKind, branchId, from, to, prices: new Map([['slab', price]]) });
    const lists = [
      list('all', null, null, '2026-01-01', 1000),
      list('dealer', 'dealer', null, '2026-01-01', 800),
      list('dealer-new', 'dealer', null, '2026-11-01', 780),
      list('jaipur', null, 'b1', '2026-01-01', 950),
      list('dealer-jaipur', 'dealer', 'b1', '2026-01-01', 760),
      list('old', 'dealer', 'b1', '2025-01-01', 700, '2025-12-31'),
    ];
    const ask = (partyKinds: string[], branchId: string | null, date = '2026-11-13') =>
      pickPrice(lists, { itemId: 'slab', partyKinds, branchId, date })?.price;
    expect(ask([], null)).toBe(1000);
    expect(ask(['customer'], 'b2')).toBe(1000);
    expect(ask(['dealer'], null)).toBe(780);
    expect(ask(['dealer'], null, '2026-10-01')).toBe(800);
    expect(ask([], 'b1')).toBe(950);
    expect(ask(['dealer'], 'b1')).toBe(760);
    expect(
      pickPrice(lists, { itemId: 'other', partyKinds: [], branchId: null, date: '2026-11-13' }),
    ).toBeNull();

    const board = [
      { date: '2026-11-10', rate: 7200_00 },
      { date: '2026-11-13', rate: 7350_00 },
    ];
    expect(rateOnBoard(board, '2026-11-12')).toBe(7200_00);
    expect(rateOnBoard(board, '2026-11-13')).toBe(7350_00);
    expect(rateOnBoard(board, '2026-11-01')).toBeNull();
    // A 4.250 g ring of 22 k at ₹7,350 a gram of 24 k.
    expect(boardPrice(7350_00, 4.25, 0.916)).toBe(28_61_355);
  });

  it('the stock papers follow their machines', () => {
    const t = (from: string, action: string, role: string, differences = false) =>
      transition(transferMachine, {
        from: from as 'REQUESTED',
        action: action as 'approve',
        roles: [role as 'supplier'],
        ctx: { differences },
      }).to;
    expect(t('REQUESTED', 'approve', 'supplier')).toBe('APPROVED');
    expect(t('APPROVED', 'dispatch', 'supplier')).toBe('DISPATCHED');
    expect(t('DISPATCHED', 'receive', 'receiver')).toBe('CLOSED');
    expect(t('DISPATCHED', 'receive', 'receiver', true)).toBe('RECEIVED');
    expect(t('RECEIVED', 'settle', 'approver')).toBe('CLOSED');
    expect(() => t('REQUESTED', 'dispatch', 'supplier')).toThrow();
    expect(() => t('DISPATCHED', 'cancel', 'asker')).toThrow();
    expect(() => t('APPROVED', 'dispatch', 'asker')).toThrow();
    expect(
      transition(productionMachine, { from: 'PLANNED', action: 'finish', roles: ['maker'], ctx: {} }).to,
    ).toBe('DONE');
    expect(() =>
      transition(productionMachine, { from: 'DONE', action: 'cancel', roles: ['maker'], ctx: {} }),
    ).toThrow();
    const c = (differences: boolean) =>
      transition(closingCountMachine, {
        from: 'OPEN',
        action: 'submit',
        roles: ['counter'],
        ctx: { differences },
      }).to;
    expect(c(false)).toBe('APPROVED');
    expect(c(true)).toBe('SUBMITTED');
  });
});
