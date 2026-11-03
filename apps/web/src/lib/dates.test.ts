import { describe, expect, it } from 'vitest';
import { dmyToIso, isoToDmy, maskDmy, parseTime } from './date-text';
import { matchScore, rankOptions } from './pick';

describe('dates are DD/MM/YYYY only', () => {
  it('reads day first, never month first', () => {
    expect(dmyToIso('04/11/2026')).toBe('2026-11-04');
    expect(dmyToIso('4/11/26')).toBe('2026-11-04');
    expect(dmyToIso('4-11-2026')).toBe('2026-11-04');
    expect(dmyToIso('4/11', 2026)).toBe('2026-11-04');
    expect(dmyToIso('11/04/2026')).toBe('2026-04-11');
  });
  it('rejects dates that do not exist', () => {
    expect(dmyToIso('31/02/2026')).toBeNull();
    expect(dmyToIso('13/13/2026')).toBeNull();
    expect(dmyToIso('00/01/2026')).toBeNull();
    expect(dmyToIso('29/02/2028')).toBe('2028-02-29');
    expect(dmyToIso('hello')).toBeNull();
  });
  it('formats and masks', () => {
    expect(isoToDmy('2026-11-04')).toBe('04/11/2026');
    expect(maskDmy('0411')).toBe('04/11');
    expect(maskDmy('04112026')).toBe('04/11/2026');
    expect(maskDmy('04/11/2026x9')).toBe('04/11/2026');
  });
  it('reads times the way people type them', () => {
    expect(parseTime('18:00')).toBe('18:00');
    expect(parseTime('1800')).toBe('18:00');
    expect(parseTime('6pm')).toBe('18:00');
    expect(parseTime('6:30 pm')).toBe('18:30');
    expect(parseTime('12am')).toBe('00:00');
    expect(parseTime('12 pm')).toBe('12:00');
    expect(parseTime('9')).toBe('09:00');
    expect(parseTime('0630')).toBe('06:30');
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('13pm')).toBeNull();
    expect(parseTime('18:75')).toBeNull();
  });
});

describe('type-to-filter', () => {
  const people = [
    { value: '1', label: 'Ramesh Gurjar · Truck Driver' },
    { value: '2', label: 'Rakesh Meena · Press Operator' },
    { value: '3', label: 'Sohan Singh · Truck Driver' },
    { value: '4', label: 'Pappu Ram · Fitter' },
  ];
  it('puts the best match first and drops the rest', () => {
    expect(rankOptions('ra', people).map((p) => p.value)).toEqual(['1', '2', '4']);
    expect(rankOptions('driver', people).map((p) => p.value)).toEqual(['1', '3']);
    expect(rankOptions('sohan dri', people).map((p) => p.value)).toEqual(['3']);
    expect(rankOptions('xyz', people)).toEqual([]);
    expect(rankOptions('', people)).toHaveLength(4);
  });
  it('forgives missing letters and case', () => {
    expect(matchScore('rmsh', 'Ramesh Gurjar')).toBeGreaterThan(0);
    expect(matchScore('RAMESH', 'ramesh gurjar')).toBe(4);
  });
});
