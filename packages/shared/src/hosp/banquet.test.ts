import { describe, expect, it } from 'vitest';
import {
  advanceNeeded,
  billCovers,
  bottlesAndMl,
  cancelOutcome,
  complianceState,
  dryDayOn,
  inRange,
  isLiquor,
  quoteLines,
  reminderDue,
  type BanquetQuote,
} from './banquet';
import { banquetMachine } from '../machines/banquet';
import { transition } from '../machines/transition';

const quote: BanquetQuote = {
  packageId: 'p',
  packageName: 'Silver',
  pricePerPlate: 800_00,
  taxCode: 'GST5',
  items: [],
  guaranteedCovers: 100,
  hallRent: 25000_00,
  rentTaxCode: 'GST18',
  extras: [{ name: 'Flowers', amount: 5000_00 }],
  discount: 0,
};

describe('banquets (B3, B5, B9, B11, B12)', () => {
  it('a quotation is plates × covers, the hall and the extras', () => {
    expect(quoteLines(quote, 100).map((l) => [l.item, l.qty, l.rate, l.taxCode])).toEqual([
      ['Silver — per plate', 100, 800_00, 'GST5'],
      ['Hall rent', 1, 25000_00, 'GST18'],
      ['Flowers', 1, 5000_00, null],
    ]);
    expect(quoteLines({ ...quote, pricePerPlate: 0, hallRent: 0, extras: [] }, 10)).toEqual([]);
  });
  it('bills what came, never under the guarantee', () => {
    expect(billCovers(100, 92)).toBe(100);
    expect(billCovers(100, 118)).toBe(118);
    expect(billCovers(100)).toBe(100);
  });
  it('the advance and what cancelling gives back', () => {
    expect(advanceNeeded({ advancePct: 25 }, 118000_00)).toBe(29500_00);
    expect(advanceNeeded({ advancePct: 0 }, 118000_00)).toBe(0);
    expect(cancelOutcome({ cancelFreeDays: 15 }, 20)).toBe('REFUND');
    expect(cancelOutcome({ cancelFreeDays: 15 }, 3)).toBe('KEEP');
  });
  it('the event machine', () => {
    const go = (
      from: string,
      action: string,
      ctx = { advancePaid: true, checked: true, settled: true },
      role = 'sales',
    ) =>
      transition(banquetMachine, {
        from: from as 'ENQUIRY',
        action: action as 'quote',
        roles: [role as 'sales'],
        ctx,
      }).to;
    expect(go('ENQUIRY', 'quote')).toBe('QUOTED');
    expect(go('QUOTED', 'quote')).toBe('QUOTED');
    expect(() => go('QUOTED', 'confirm', { advancePaid: false, checked: false, settled: false })).toThrow();
    expect(go('QUOTED', 'confirm')).toBe('CONFIRMED');
    expect(go('CONFIRMED', 'revise')).toBe('CONFIRMED');
    expect(() =>
      go('CONFIRMED', 'complete', { advancePaid: true, checked: false, settled: false }),
    ).toThrow();
    expect(go('CONFIRMED', 'complete')).toBe('COMPLETED');
    expect(() => go('COMPLETED', 'close', { advancePaid: true, checked: true, settled: false })).toThrow();
    expect(go('COMPLETED', 'close')).toBe('CLOSED');
    expect(go('QUOTED', 'lose')).toBe('LOST');
    expect(() => go('CONFIRMED', 'cancel')).toThrow();
    expect(go('CONFIRMED', 'cancel', undefined, 'manager')).toBe('CANCELLED');
    expect(() => go('CLOSED', 'quote')).toThrow();
  });
});

describe('the bar (B13, B14, B16)', () => {
  it('reads ml as bottles and the open bottle', () => {
    expect(bottlesAndMl(8700, 750)).toEqual({ bottles: 11, ml: 450 });
    expect(bottlesAndMl(750, 750)).toEqual({ bottles: 1, ml: 0 });
    expect(bottlesAndMl(90, 0)).toEqual({ bottles: 0, ml: 90 });
  });
  it('knows liquor and dry days', () => {
    const bar = {
      liquorCategories: ['Liquor', 'Beer'],
      dryDays: [{ date: '2026-10-02', reason: 'Gandhi Jayanti' }],
    };
    expect(isLiquor(bar, 'liquor')).toBe(true);
    expect(isLiquor(bar, 'Mixers')).toBe(false);
    expect(isLiquor(bar, null)).toBe(false);
    expect(dryDayOn(bar, '2026-10-02')?.reason).toBe('Gandhi Jayanti');
    expect(dryDayOn(bar, '2026-10-03')).toBeNull();
  });
});

describe('compliance (B17–B19)', () => {
  it('valid, expiring, expired', () => {
    expect(complianceState('2027-03-31', '2026-11-13', [60, 30, 7])).toBe('VALID');
    expect(complianceState('2026-12-31', '2026-11-13', [60, 30, 7])).toBe('EXPIRING');
    expect(complianceState('2026-11-13', '2026-11-13', [60, 30, 7])).toBe('EXPIRING');
    expect(complianceState('2026-11-12', '2026-11-13', [60, 30, 7])).toBe('EXPIRED');
  });
  it('one reminder at each step', () => {
    const r = (today: string) => reminderDue('2026-12-31', today, [60, 30, 7]);
    expect(r('2026-10-01')).toBeNull();
    expect(r('2026-11-01')).toBe('d60');
    expect(r('2026-11-20')).toBe('d60');
    expect(r('2026-12-01')).toBe('d30');
    expect(r('2026-12-24')).toBe('d7');
    expect(r('2026-12-31')).toBe('d0');
    expect(r('2027-01-05')).toBe('expired');
  });
  it('temperature limits', () => {
    expect(inRange({ min: 0, max: 5 }, 3.5)).toBe(true);
    expect(inRange({ min: 0, max: 5 }, 7)).toBe(false);
    expect(inRange({ max: -18 }, -20)).toBe(true);
    expect(inRange({ min: 63 }, 60)).toBe(false);
    expect(inRange({}, 99)).toBe(true);
  });
});
