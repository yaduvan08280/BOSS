import { describe, expect, it } from 'vitest';
import { addDays, weekdayOf } from '../work/calendar';
import {
  computePay,
  DEFAULT_PAY_RULES,
  payPolicyFor,
  payRulesSchema,
  type PayDay,
  type PayPolicy,
} from './pay';

/** November 2026: 30 days, Sundays 1, 8, 15, 22, 29 off; 9th a holiday → 24 working days. */
function month(over: (d: PayDay) => Partial<PayDay> = () => ({})): PayDay[] {
  return Array.from({ length: 30 }, (_, i) => {
    const date = addDays('2026-11-01', i);
    const kind = weekdayOf(date) === 7 ? 'weeklyOff' : date === '2026-11-09' ? 'holiday' : 'working';
    const base: PayDay = {
      date,
      kind,
      status: kind === 'working' ? 'PRESENT' : kind === 'holiday' ? 'HOLIDAY' : 'WEEKLY_OFF',
      workedMin: kind === 'working' ? 540 : 0,
      overtimeMin: 0,
      leave: null,
    };
    return { ...base, ...over(base) };
  });
}
// Extra pay for day-off work (the company default is a comp-off).
const policy = (p: Partial<PayPolicy> = {}): PayPolicy => ({
  ...payPolicyFor(DEFAULT_PAY_RULES, { id: 'x', departmentId: null, designationId: null }),
  dayOffWork: 'multiplier',
  ...p,
});
const pay = (
  days: PayDay[],
  p: Partial<PayPolicy> = {},
  basis: 'monthly' | 'daily' | 'hourly' = 'monthly',
  rate = 3_000_000,
) =>
  computePay({
    basis,
    ratePaise: rate,
    days,
    asOf: '2026-11-30',
    policy: policy(p),
    dayHours: 8,
    pattern: { kind: 'shift' },
  });
const rupees = (paise: number) => paise / 100;

describe('monthly salary', () => {
  it('calendar days (Sundays and holidays paid): full attendance is the full salary; an absence costs 1/30', () => {
    expect(rupees(pay(month()).grossPaise)).toBe(30_000);
    const one = pay(month((d) => (d.date === '2026-11-03' ? { status: 'ABSENT', workedMin: 0 } : {})));
    expect(one.divisor).toBe(30);
    expect(rupees(one.grossPaise)).toBe(29_000);
    expect(one.counts).toMatchObject({ absent: 1, workingDays: 24, offDays: 6 });
  });
  it('working days only, or a fixed 26: the day value changes', () => {
    const absent = (d: PayDay) =>
      d.date === '2026-11-03' ? { status: 'ABSENT' as const, workedMin: 0 } : {};
    expect(pay(month(absent), { monthDays: 'working' }).divisor).toBe(24);
    expect(rupees(pay(month(absent), { monthDays: 'working' }).grossPaise)).toBe(28_750);
    expect(rupees(pay(month(absent), { monthDays: 'fixed', fixedDays: 26 }).grossPaise)).toBeCloseTo(
      28_846.15,
      2,
    );
  });
  it('Sundays not paid (calendar basis): they are cut', () => {
    expect(rupees(pay(month(), { paidOffDays: false }).grossPaise)).toBe(24_000);
  });
  it('working on a Sunday or holiday earns extra: a multiple of a day, a fixed amount, or only a comp-off', () => {
    const sunday = (d: PayDay) => (d.date === '2026-11-15' ? { workedMin: 540 } : {});
    expect(rupees(pay(month(sunday)).grossPaise)).toBe(31_000);
    expect(rupees(pay(month(sunday), { dayOffMultiplier: 2 }).grossPaise)).toBe(32_000);
    expect(rupees(pay(month(sunday), { dayOffWork: 'fixed', dayOffFixedPaise: 50_000 }).grossPaise)).toBe(
      30_500,
    );
    expect(rupees(pay(month(sunday), { dayOffWork: 'compOff' }).grossPaise)).toBe(30_000);
    // Half a day on a holiday is half the extra.
    expect(rupees(pay(month((d) => (d.date === '2026-11-09' ? { workedMin: 300 } : {}))).grossPaise)).toBe(
      30_500,
    );
  });
  it('half days, paid leave and leave without pay', () => {
    const r = pay(
      month((d) =>
        d.date === '2026-11-03'
          ? { status: 'HALF_DAY', workedMin: 300 }
          : d.date === '2026-11-04'
            ? { status: 'ON_LEAVE', leave: { paid: true, half: false } }
            : d.date === '2026-11-05'
              ? { status: 'ON_LEAVE', leave: { paid: false, half: false } }
              : {},
      ),
    );
    expect(r.counts).toMatchObject({ halfDays: 1, paidLeave: 1, unpaidLeave: 1 });
    expect(rupees(r.grossPaise)).toBe(28_500);
  });
  it('overtime at twice the hourly rate; late days cut by the rule', () => {
    const ot = pay(month((d) => (d.date === '2026-11-03' ? { overtimeMin: 120 } : {})));
    // 30,000 / 30 / 8 = 125 an hour → 2 h × 250 = 500.
    expect(rupees(ot.grossPaise)).toBe(30_500);
    const lates = month((d) =>
      ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].includes(d.date) ? { status: 'LATE' } : {},
    );
    expect(rupees(pay(lates).grossPaise)).toBe(30_000);
    expect(rupees(pay(lates, { lateEvery: 3, lateCutDays: 0.5 }).grossPaise)).toBe(29_500);
  });
  it('someone who joins in the month is paid from the day they joined', () => {
    const r = pay(
      month((d) => (d.date < '2026-11-16' ? { employed: false, status: null, workedMin: 0 } : {})),
    );
    expect(r.counts.notJoined).toBe(15);
    expect(rupees(r.grossPaise)).toBe(15_000);
    expect(
      rupees(
        pay(
          month((d) => (d.date < '2026-11-16' ? { employed: false } : {})),
          {},
          'daily',
          80_000,
        ).grossPaise,
      ),
    ).toBe((13 + 2) * 800);
  });
  it('a running month is not cut for the days still to come', () => {
    const r = computePay({
      basis: 'monthly',
      ratePaise: 3_000_000,
      days: month(),
      asOf: '2026-11-10',
      policy: policy(),
      dayHours: 8,
      pattern: { kind: 'shift' },
    });
    expect(rupees(r.grossPaise)).toBe(30_000);
    expect(r.counts.days).toBe(10);
  });
});

describe('daily and hourly pay', () => {
  it('daily: pay for each day worked (half days half), off days if they are paid', () => {
    const days = month((d) =>
      d.date === '2026-11-03'
        ? { status: 'HALF_DAY', workedMin: 300 }
        : d.date === '2026-11-04'
          ? { status: 'ABSENT', workedMin: 0 }
          : {},
    );
    // 22.5 working days + 6 paid off days at ₹800.
    expect(rupees(pay(days, {}, 'daily', 80_000).grossPaise)).toBe(22_800);
    expect(rupees(pay(days, { paidOffDays: false }, 'daily', 80_000).grossPaise)).toBe(18_000);
  });
  it('hourly: the hours worked, overtime premium on top, Sunday hours at the day-off rate', () => {
    const days = month((d) => (d.kind !== 'working' ? {} : { workedMin: 480 }));
    // 24 days × 8 h × ₹100 = 19,200; off days not paid for hourly staff here.
    expect(rupees(pay(days, { paidOffDays: false }, 'hourly', 10_000).grossPaise)).toBe(19_200);
    const extra = month((d) =>
      d.date === '2026-11-03'
        ? { workedMin: 600, overtimeMin: 120 }
        : d.date === '2026-11-15'
          ? { workedMin: 480 }
          : d.kind !== 'working'
            ? {}
            : { workedMin: 480 },
    );
    // +2 h worked (200) + 2 h overtime premium at ×2 (200) + Sunday 8 h at ×1 (800).
    expect(rupees(pay(extra, { paidOffDays: false }, 'hourly', 10_000).grossPaise)).toBe(20_400);
  });
});

describe('weekly hours', () => {
  it('short weeks are cut at the hourly rate; extra hours are overtime', () => {
    // 48 h a week = 8 h a working day. Week of 2–7 Nov: 6 days × 7 h = 42 h → 6 h short.
    const days = month((d) =>
      d.date >= '2026-11-02' && d.date <= '2026-11-07'
        ? { workedMin: 420 }
        : d.kind === 'working'
          ? { workedMin: 480 }
          : {},
    );
    const r = computePay({
      basis: 'monthly',
      ratePaise: 3_000_000,
      days,
      asOf: '2026-11-30',
      policy: policy({ overtimePay: false }),
      dayHours: 8,
      pattern: { kind: 'weekly' },
      weeklyHours: 48,
    });
    expect(r.lines.find((l) => l.key === 'shortHours')).toMatchObject({ qty: -6, amountPaise: -75_000 });
    expect(rupees(r.grossPaise)).toBe(29_250);
    // Status "absent" on a weekly-hours day doesn't cut a day: only the hours count.
    expect(r.counts.absent).toBe(0);
  });
});

describe('pay rules by department, designation and person', () => {
  it('by default working a day off earns a comp-off, not pay', () => {
    expect(DEFAULT_PAY_RULES.dayOffWork).toBe('compOff');
  });
  it('the most specific rule wins', () => {
    const rules = payRulesSchema.parse({
      overrides: [
        { scope: 'department', id: 'prod', rules: { monthDays: 'working', dayOffMultiplier: 1.5 } },
        { scope: 'designation', id: 'driver', rules: { monthDays: 'fixed', fixedDays: 26 } },
        { scope: 'person', id: 'ravi', rules: { dayOffMultiplier: 2 } },
      ],
    });
    expect(payPolicyFor(rules, { id: 'x', departmentId: 'prod', designationId: null })).toMatchObject({
      monthDays: 'working',
      dayOffMultiplier: 1.5,
    });
    expect(payPolicyFor(rules, { id: 'x', departmentId: 'prod', designationId: 'driver' })).toMatchObject({
      monthDays: 'fixed',
      dayOffMultiplier: 1.5,
    });
    expect(payPolicyFor(rules, { id: 'ravi', departmentId: 'prod', designationId: 'driver' })).toMatchObject({
      monthDays: 'fixed',
      dayOffMultiplier: 2,
    });
  });
});
