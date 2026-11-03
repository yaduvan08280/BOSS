import { describe, expect, it } from 'vitest';
import { formatINR, groupIndian, inrInWords, rupeesToPaise } from './money';
import {
  financialYear,
  formatDate,
  formatDateTime,
  formatLocalDate,
  formatShortDateTime,
  hhmmToMinutes,
  minutesToHHmm,
} from './date';
import { normalizeMobile } from './phone';

describe('money', () => {
  it('groups digits the Indian way', () => {
    expect(groupIndian(12345678n)).toBe('1,23,45,678');
    expect(groupIndian(999n)).toBe('999');
    expect(groupIndian(-100000n)).toBe('-1,00,000');
  });
  it('formats full and compact', () => {
    expect(formatINR(12345678n)).toBe('₹1,23,456.78');
    expect(formatINR(rupeesToPaise('13100000'), { compact: true })).toBe('₹1.31 Cr');
    expect(formatINR(rupeesToPaise('4536000'), { compact: true })).toBe('₹45.36 L');
    expect(formatINR(rupeesToPaise('12500'), { compact: true })).toBe('₹12,500');
    expect(formatINR('-1050', { decimals: false })).toBe('-₹11');
  });
  it('converts rupees to paise without float errors', () => {
    expect(rupeesToPaise('10.5')).toBe(1050n);
    expect(rupeesToPaise(0.1)).toBe(10n);
    expect(rupeesToPaise('-2.25')).toBe(-225n);
  });
  it('writes short words', () => {
    expect(inrInWords(rupeesToPaise(50_000_000))).toBe('₹5 crore');
    expect(inrInWords(rupeesToPaise(4_500_000))).toBe('₹45 lakh');
  });
});

describe('dates', () => {
  const d = new Date('2026-03-31T20:00:00Z'); // 01/04/2026 01:30 IST
  it('shows DD/MM/YYYY in company time zone', () => {
    expect(formatDate(d)).toBe('01/04/2026');
    expect(formatDateTime(d)).toBe('01/04/2026 01:30');
    expect(formatDate(d, 'UTC')).toBe('31/03/2026');
  });
  it('computes FY April–March in the company time zone', () => {
    expect(financialYear(d).short).toBe('26-27');
    expect(financialYear(d, 'UTC').short).toBe('25-26');
    expect(financialYear(new Date('2027-01-15T00:00:00Z')).label).toBe('FY 2026-27');
  });
  it('round-trips wall-clock minutes', () => {
    expect(minutesToHHmm(hhmmToMinutes('23:00'))).toBe('23:00');
    expect(minutesToHHmm(1440 + 30)).toBe('00:30');
    expect(() => hhmmToMinutes('24:00')).toThrow();
  });
});

describe('every date shows DD/MM/YYYY (never month first, never without the year)', () => {
  it('formats instants and local dates the same way', () => {
    const d = new Date('2026-11-04T12:30:00Z'); // 18:00 IST on 4 November
    expect(formatDate(d)).toBe('04/11/2026');
    expect(formatShortDateTime(d)).toBe('04/11/2026 18:00');
    expect(formatLocalDate('2026-11-04')).toBe('04/11/2026');
  });
});

describe('phone', () => {
  it('normalises Indian mobiles to E.164', () => {
    expect(normalizeMobile('98290 12345')).toBe('+919829012345');
    expect(normalizeMobile('09829012345')).toBe('+919829012345');
    expect(normalizeMobile('+91 98290-12345')).toBe('+919829012345');
    expect(normalizeMobile('919829012345')).toBe('+919829012345');
    expect(normalizeMobile('12345')).toBeNull();
  });
});
