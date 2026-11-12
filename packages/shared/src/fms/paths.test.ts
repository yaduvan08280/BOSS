import { describe, expect, it } from 'vitest';
import type { FlowField } from './definition';
import { fillPaths, flowFieldMap, numberOf, parsePath, pathsIn, showStored } from './paths';

const f = (key: string, type: FlowField['type']) => ({ key, label: key, type }) as FlowField;

describe('value paths (showing values anywhere)', () => {
  it('L18: a path is a field, or a column of the row the field links to', () => {
    expect(parsePath('customer')).toEqual({ field: 'customer' });
    expect(parsePath(' customer.city ')).toEqual({ field: 'customer', column: 'city' });
    for (const bad of ['', 'Customer', 'a.b.c', '1x', 'a..b', 'a.', '_refs', 'a b'])
      expect(parsePath(bad), bad).toBeNull();
  });

  it('L18: holes in a text are found and filled; a path with no value prints nothing', () => {
    const text = 'Dear {{customer}}, {{ item.rate }} for {{customer}} — {{nope}}.';
    expect(pathsIn(text)).toEqual(['customer', 'item.rate', 'nope']);
    const read = (p: string) => ({ customer: 'Sharma Traders', 'item.rate': '₹1,200' })[p];
    expect(fillPaths(text, read)).toBe('Dear Sharma Traders, ₹1,200 for Sharma Traders — .');
    expect(pathsIn(null)).toEqual([]);
  });

  it('L18: stored values read as people write them', () => {
    const tz = 'Asia/Kolkata';
    expect(showStored(f('d', 'date'), '2026-12-14', tz)).toBe('14/12/2026');
    expect(showStored(f('t', 'datetime'), '2026-12-14T04:30:00.000Z', tz)).toBe('14/12/2026 10:00');
    expect(showStored(f('a', 'amount'), 370351.5, tz)).toBe('₹3,70,351.5');
    expect(showStored(f('x', 'formula'), 414793.68, tz)).toBe('4,14,793.68');
    expect(showStored(f('y', 'yesno'), true, tz)).toBe('Yes');
    expect(showStored(f('y', 'yesno'), false, tz, ['हाँ', 'नहीं'])).toBe('नहीं');
    expect(showStored(f('m', 'multiselect'), ['A', 'B'], tz)).toBe('A, B');
    expect(showStored(f('n', 'number'), 12, tz)).toBe('12');
    // A column of a linked row has no field: it is read by its look.
    expect(showStored(undefined, '2026-04-01', tz)).toBe('01/04/2026');
    expect(showStored(undefined, 125000, tz)).toBe('1,25,000');
    expect(showStored(f('i', 'items'), [{ item: 'x' }], tz)).toBeNull();
    expect(showStored(f('s', 'text'), '', tz)).toBeNull();
  });

  it('L18: numbers are read from numbers and from typed text; fields are found start form first', () => {
    expect(numberOf(12.5)).toBe(12.5);
    expect(numberOf('₹1,200.50')).toBe(1200.5);
    expect(numberOf('twelve')).toBeNull();
    expect(numberOf('')).toBeNull();
    const map = flowFieldMap({
      startFields: [f('customer', 'master')],
      steps: [{ fields: [f('customer', 'text'), f('qty', 'number')] }] as never,
    });
    expect(map.get('customer')?.type).toBe('master');
    expect([...map.keys()]).toEqual(['customer', 'qty']);
  });
});
