import { describe, expect, it } from 'vitest';
import { buddyMachine, coverMachine, leaveMachine } from '../machines/hr';
import { transition } from '../machines/transition';
import { checkPunchPlace, computeDay, distanceM, type DayInput, type PunchIn } from './attendance';
import { leaveDays, leaveYearOf, needsBuddy, suggestBuddies } from './leave';
import { DEFAULT_HR_RULES, hrRulesSchema, rulesFor } from './rules';

const TZ = 'Asia/Kolkata';
/** "09:12" on the day (IST) → an instant. */
const at = (hhmm: string, date = '2026-11-03') => new Date(`${date}T${hhmm}:00+05:30`);
const p = (type: 'IN' | 'OUT', hhmm: string, date?: string): PunchIn => ({ type, at: at(hhmm, date) });
const rules = rulesFor(DEFAULT_HR_RULES, { id: 'u', departmentId: null });
const day = (punches: PunchIn[], over: Partial<DayInput> = {}) =>
  computeDay({
    date: '2026-11-03',
    kind: 'working',
    leave: null,
    shift: { start: 9 * 60, end: 18 * 60 },
    punches,
    tz: TZ,
    rules,
    ...over,
  });

describe('attendance rules (§9.1 defaults: grace 15 min, half day after 150 min, 8 h full day)', () => {
  it('on time, inside the grace, and late', () => {
    expect(day([p('IN', '08:55'), p('OUT', '18:05')])).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
    expect(day([p('IN', '09:15'), p('OUT', '18:00')])).toMatchObject({ status: 'PRESENT', lateMinutes: 15 });
    expect(day([p('IN', '09:16'), p('OUT', '18:00')])).toMatchObject({
      status: 'LATE',
      lateMinutes: 16,
      reasons: ['16 min late'],
    });
  });
  it('very late or too few hours is a half day; under half the hours is absent', () => {
    expect(day([p('IN', '11:30'), p('OUT', '20:00')])).toMatchObject({
      status: 'HALF_DAY',
      lateMinutes: 150,
    });
    expect(day([p('IN', '09:00'), p('OUT', '15:00')])).toMatchObject({
      status: 'HALF_DAY',
      workedMinutes: 360,
    });
    expect(day([p('IN', '09:00'), p('OUT', '12:30')])).toMatchObject({
      status: 'ABSENT',
      workedMinutes: 210,
    });
    expect(day([])).toMatchObject({ status: 'ABSENT', reasons: ['No punch'] });
  });
  it('uses the first IN and the last OUT, ignoring stray punches', () => {
    const r = day([
      p('OUT', '08:00'),
      p('IN', '09:05'),
      p('OUT', '13:00'),
      p('IN', '14:00'),
      p('OUT', '18:10'),
    ]);
    expect(r).toMatchObject({ status: 'PRESENT', workedMinutes: 545 });
    expect(r.inAt).toEqual(at('09:05'));
  });
  it('a missed punch-out is a half day until corrected, or counts to shift end if the rule says so', () => {
    expect(day([p('IN', '09:00')])).toMatchObject({ status: 'HALF_DAY', missedOut: true });
    const shiftEnd = { ...rules, late: { ...rules.late, missedPunchOut: 'shiftEnd' as const } };
    expect(day([p('IN', '09:00')], { rules: shiftEnd })).toMatchObject({
      status: 'PRESENT',
      missedOut: true,
      workedMinutes: 540,
    });
  });
  it('overtime counts only past the threshold, and only when switched on', () => {
    expect(day([p('IN', '09:00'), p('OUT', '18:20')]).overtimeMinutes).toBe(0);
    expect(day([p('IN', '09:00'), p('OUT', '18:45')]).overtimeMinutes).toBe(45);
    const off = { ...rules, punches: { ...rules.punches, overtime: false } };
    expect(day([p('IN', '09:00'), p('OUT', '20:00')], { rules: off }).overtimeMinutes).toBe(0);
  });
  it('night shifts count on the date they start (decision 17)', () => {
    const night = { start: 23 * 60, end: 7 * 60 };
    const r = day([p('IN', '22:58'), p('OUT', '07:02', '2026-11-04')], { shift: night });
    expect(r).toMatchObject({ status: 'PRESENT', workedMinutes: 484, lateMinutes: 0 });
    expect(day([p('IN', '23:40'), p('OUT', '08:00', '2026-11-04')], { shift: night })).toMatchObject({
      status: 'LATE',
      lateMinutes: 40,
    });
  });
  it('leave, holidays and weekly offs', () => {
    expect(day([p('IN', '09:00')], { leave: 'full' }).status).toBe('ON_LEAVE');
    // Half-day leave: half the hours are a full day's attendance, and coming in late is the leave.
    expect(day([p('IN', '13:30'), p('OUT', '18:00')], { leave: 'half' }).status).toBe('PRESENT');
    expect(day([], { leave: 'half' }).status).toBe('ABSENT');
    expect(day([], { kind: 'holiday' })).toMatchObject({ status: 'HOLIDAY', compOff: false });
    expect(day([p('IN', '09:00'), p('OUT', '14:00')], { kind: 'weeklyOff' })).toMatchObject({
      status: 'WEEKLY_OFF',
      compOff: true,
      workedMinutes: 300,
    });
  });
});

describe('HR rules', () => {
  it('fills every answer with the wizard default', () => {
    expect(DEFAULT_HR_RULES).toMatchObject({
      late: { graceMinutes: 15, halfDayAfterMinutes: 150, fullDayHours: 8, missedPunchOut: 'halfDay' },
      punches: { awayFromOffice: 'block', noLocation: 'flag', selfie: false, correctionsPerMonth: 3 },
      leave: { yearStartMonth: 4, compOffValidDays: 60, noticeDays: 30 },
      buddy: { noBuddy: 'warn', needsBuddy: 'any', otherDepartment: false, maxCover: 3 },
      buddyAnswer: { answerHours: 4, onReturn: 'notStarted', absentConfirmHours: 2 },
      autopilot: {
        autoPick: false,
        autoApproveShort: false,
        absentToBuddy: false,
        morningReport: true,
        morningReportAt: '08:30',
      },
    });
    expect(DEFAULT_HR_RULES.buddyAnswer.order).toEqual([
      'fmsBackup',
      'defaultBuddy',
      'sameDepartment',
      'hod',
    ]);
  });
  it('lets a department and then a person differ', () => {
    const r = hrRulesSchema.parse({
      overrides: [
        {
          scope: 'department',
          id: 'drivers',
          late: { graceMinutes: 30 },
          punches: { awayFromOffice: 'flag' },
        },
        { scope: 'person', id: 'ravi', late: { graceMinutes: 0 } },
      ],
    });
    expect(rulesFor(r, { id: 'x', departmentId: 'drivers' })).toMatchObject({
      late: { graceMinutes: 30, fullDayHours: 8 },
      punches: { awayFromOffice: 'flag' },
    });
    expect(rulesFor(r, { id: 'ravi', departmentId: 'drivers' })).toMatchObject({
      late: { graceMinutes: 0 },
      punches: { awayFromOffice: 'flag' },
    });
  });
});

describe('punch place (geofence)', () => {
  const office = { lat: 26.5917, lng: 74.8542, radiusM: 150 };
  it('measures distance', () => {
    expect(Math.round(distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) / 1000)).toBe(111);
  });
  it('blocks or flags away from the office and without a location, by the rules', () => {
    const inside = { lat: 26.5918, lng: 74.8543, accuracy: 20 };
    const away = { lat: 26.6017, lng: 74.8542, accuracy: 20 }; // ~1.1 km north
    expect(checkPunchPlace(rules.punches, office, inside)).toEqual({ allow: true, flag: null });
    expect(checkPunchPlace(rules.punches, office, away)).toMatchObject({
      allow: false,
      flag: expect.stringMatching(/m from the office/),
    });
    expect(checkPunchPlace({ ...rules.punches, awayFromOffice: 'flag' }, office, away).allow).toBe(true);
    expect(checkPunchPlace(rules.punches, office, null)).toEqual({
      allow: true,
      flag: 'Location could not be read',
    });
    expect(checkPunchPlace({ ...rules.punches, noLocation: 'block' }, office, null).allow).toBe(false);
    expect(checkPunchPlace(rules.punches, null, null)).toEqual({ allow: true, flag: null });
  });
});

describe('leave', () => {
  const cal = { holidays: new Set(['2026-11-09']), workingWeekdays: new Set([1, 2, 3, 4, 5, 6]) };
  it('counts working days only; a half day is 0.5', () => {
    // Fri 06/11 → Tue 10/11: Sunday 08/11 is off and Monday 09/11 a holiday.
    expect(leaveDays('2026-11-06', '2026-11-10', false, cal)).toBe(3);
    expect(leaveDays('2026-11-06', '2026-11-06', true, cal)).toBe(0.5);
    expect(leaveDays('2026-11-08', '2026-11-08', false, cal)).toBe(0);
  });
  it('asks for a Buddy by the rule', () => {
    const b = DEFAULT_HR_RULES.buddy;
    expect(needsBuddy(b, { days: 0.5, half: true })).toBe(true);
    expect(needsBuddy({ ...b, needsBuddy: 'fullDay' }, { days: 0.5, half: true })).toBe(false);
    expect(needsBuddy({ ...b, needsBuddy: 'days', needsBuddyDays: 2 }, { days: 1, half: false })).toBe(false);
    expect(needsBuddy({ ...b, noBuddy: 'off' }, { days: 5, half: false })).toBe(false);
  });
  it('suggests Buddies in the company order, skipping people who are away or full', () => {
    const c = {
      fmsBackup: ['backup'],
      defaultBuddy: 'friend',
      sameDepartment: ['away', 'free1', 'free2'],
      hod: 'hod',
    };
    expect(suggestBuddies(DEFAULT_HR_RULES.buddyAnswer.order, c, new Set(['away']))).toEqual([
      'backup',
      'friend',
      'free1',
      'free2',
      'hod',
    ]);
    expect(
      suggestBuddies(
        ['hod', 'defaultBuddy', 'fmsBackup', 'sameDepartment'],
        { ...c, fmsBackup: [] },
        new Set(['friend']),
      ),
    ).toEqual(['hod', 'away', 'free1', 'free2']);
  });
  it('knows the leave year (April or January)', () => {
    expect(leaveYearOf('2026-03-31', 4)).toBe(2025);
    expect(leaveYearOf('2026-04-01', 4)).toBe(2026);
    expect(leaveYearOf('2026-01-02', 1)).toBe(2026);
  });
});

describe('leave, Buddy and cover machines', () => {
  it('leave: the HOD decides; the person can call it off until it starts', () => {
    const t = (
      from: 'PENDING' | 'APPROVED',
      action: 'approve' | 'reject' | 'cancel',
      roles: ('person' | 'approver' | 'hr')[],
      started = false,
    ) => transition(leaveMachine, { from, action, roles, ctx: { started } }).to;
    expect(t('PENDING', 'approve', ['approver'])).toBe('APPROVED');
    expect(() => t('PENDING', 'approve', ['person'])).toThrow();
    expect(t('APPROVED', 'cancel', ['person'])).toBe('CANCELLED');
    expect(() => t('APPROVED', 'cancel', ['person'], true)).toThrow();
    expect(t('APPROVED', 'cancel', ['hr'], true)).toBe('CANCELLED');
  });
  it('Buddy and cover', () => {
    expect(transition(buddyMachine, { from: 'ASKED', action: 'accept', roles: ['buddy'], ctx: {} }).to).toBe(
      'ACCEPTED',
    );
    expect(() =>
      transition(buddyMachine, { from: 'ASKED', action: 'accept', roles: ['person'], ctx: {} }),
    ).toThrow();
    expect(
      transition(coverMachine, { from: 'SCHEDULED', action: 'start', roles: ['system'], ctx: {} }).to,
    ).toBe('ACTIVE');
    expect(
      transition(coverMachine, { from: 'ACTIVE', action: 'return', roles: ['system'], ctx: {} }).to,
    ).toBe('RETURNED');
  });
});
