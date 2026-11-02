import { describe, expect, it } from 'vitest';
import { localDate, weekOf, weekdayOf, zonedToUtc } from './calendar';
import { occurrences, occursOn, type Frequency } from './recurrence';
import { gradeTask, kpiState, nextTarget, rygReport, scorecard, type ScoredTask } from './scoring';

const tz = 'Asia/Kolkata';
const at = (s: string) => new Date(s);

describe('calendar', () => {
  it('converts IST wall clock to UTC and back', () => {
    expect(zonedToUtc('2026-11-02', 9 * 60 + 30, tz).toISOString()).toBe('2026-11-02T04:00:00.000Z');
    expect(localDate(at('2026-11-02T20:00:00Z'), tz)).toBe('2026-11-03');
    expect(weekdayOf('2026-11-02')).toBe(1);
    expect(weekOf(at('2026-11-08T10:00:00Z'), tz)).toMatchObject({ start: '2026-11-02', end: '2026-11-08' });
  });
});

describe('recurrence', () => {
  const on = (f: Frequency, d: string, start = '2026-01-01') => occursOn(f, d, start);
  it('handles every frequency', () => {
    expect(on({ type: 'weekdays', weekdays: [1, 3, 5] }, '2026-11-04')).toBe(true);
    expect(on({ type: 'weekly', weekday: 6 }, '2026-11-07')).toBe(true);
    expect(on({ type: 'monthly', day: 'last' }, '2026-02-28')).toBe(true);
    expect(on({ type: 'monthly', day: 31 }, '2026-11-30')).toBe(true); // 31st → last day of a 30-day month
    expect(on({ type: 'quarterly', day: 5 }, '2026-07-05', '2026-04-05')).toBe(true);
    expect(on({ type: 'quarterly', day: 5 }, '2026-08-05', '2026-04-05')).toBe(false);
    expect(on({ type: 'yearly', month: 3, day: 31 }, '2027-03-31')).toBe(true);
    expect(on({ type: 'everyN', everyN: 3 }, '2026-01-07')).toBe(true);
    expect(on({ type: 'everyN', everyN: 3 }, '2026-01-08')).toBe(false);
    expect(on({ type: 'daily' }, '2025-12-31')).toBe(false); // before start
  });

  it('skips holidays and weekly offs, and returns UTC due times', () => {
    const cal = { tz, holidays: new Set(['2026-11-04']), workingWeekdays: new Set([1, 2, 3, 4, 5, 6]) };
    const master = {
      frequency: { type: 'daily' } as Frequency,
      dueMin: 18 * 60,
      startDate: '2026-11-01',
      skipHolidays: true,
    };
    const out = occurrences(master, at('2026-11-02T00:00:00Z'), at('2026-11-09T00:00:00Z'), cal);
    expect(out.map((d) => localDate(d, tz))).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ]);
    expect(out[0]!.toISOString()).toBe('2026-11-02T12:30:00.000Z');
    expect(
      occurrences(
        { ...master, skipHolidays: false },
        at('2026-11-02T00:00:00Z'),
        at('2026-11-09T00:00:00Z'),
        cal,
      ),
    ).toHaveLength(7);
  });
});

describe('R/Y/G', () => {
  const now = at('2026-11-10T06:00:00Z');
  const t = (o: Partial<ScoredTask>): ScoredTask => ({
    doerId: 'a',
    verifierId: null,
    status: 'DONE',
    plannedAt: at('2026-11-05T12:30:00Z'),
    doneAt: null,
    verifiedAt: null,
    revisionCount: 0,
    ...o,
  });
  it('grades by lateness and revisions', () => {
    expect(gradeTask(t({ doneAt: at('2026-11-05T10:00:00Z') }), now)).toBe('GREEN');
    expect(gradeTask(t({ doneAt: at('2026-11-05T15:00:00Z') }), now)).toBe('YELLOW'); // hours late = a day
    expect(gradeTask(t({ doneAt: at('2026-11-05T10:00:00Z'), revisionCount: 1 }), now)).toBe('YELLOW');
    expect(gradeTask(t({ doneAt: at('2026-11-07T13:00:00Z') }), now)).toBe('RED');
    expect(gradeTask(t({ doneAt: at('2026-11-05T10:00:00Z'), revisionCount: 2 }), now)).toBe('RED');
    expect(gradeTask(t({ status: 'OPEN', plannedAt: at('2026-11-12T12:30:00Z') }), now)).toBe('OPEN');
    expect(gradeTask(t({ status: 'OPEN', plannedAt: at('2026-11-07T12:30:00Z') }), now)).toBe('RED'); // running, 3 days late
    expect(gradeTask(t({ status: 'CANCELLED' }), now)).toBeNull();
  });
  it('sums per person with percentages of graded work', () => {
    const rows = rygReport(
      [
        t({ doneAt: at('2026-11-05T10:00:00Z') }),
        t({ doneAt: at('2026-11-05T15:00:00Z') }),
        t({ doneAt: at('2026-11-08T15:00:00Z') }),
        t({ status: 'OPEN', plannedAt: at('2026-11-12T12:30:00Z') }),
      ],
      now,
    );
    expect(rows).toEqual([
      {
        personId: 'a',
        total: 4,
        green: 1,
        yellow: 1,
        red: 1,
        open: 1,
        pctGreen: 33,
        pctYellow: 33,
        pctRed: 33,
      },
    ]);
  });
});

describe('scorecard', () => {
  // Week Mon 02/11 – Sun 08/11/2026 IST; "now" is Thursday 05/11 18:00 IST.
  const week = weekOf(at('2026-11-04T06:00:00Z'), tz);
  const now = at('2026-11-05T12:30:00Z');
  const t = (o: Partial<ScoredTask>): ScoredTask => ({
    doerId: 'sandeep',
    verifierId: 'ajay',
    status: 'OPEN',
    plannedAt: at('2026-11-03T12:30:00Z'),
    doneAt: null,
    verifiedAt: null,
    revisionCount: 0,
    ...o,
  });
  const tasks = [
    t({ status: 'DONE', doneAt: at('2026-11-03T10:00:00Z'), verifiedAt: at('2026-11-03T10:30:00Z') }), // on time, verified in 30 min
    t({
      status: 'DONE',
      plannedAt: at('2026-11-04T12:30:00Z'),
      doneAt: at('2026-11-04T15:00:00Z'),
      verifiedAt: at('2026-11-04T18:00:00Z'),
    }), // late, slow verify
    t({ plannedAt: at('2026-11-05T06:00:00Z') }), // due, not done
    t({ plannedAt: at('2026-11-07T06:00:00Z') }), // not due yet: planned, not counted
    t({
      verifierId: null,
      status: 'DONE',
      plannedAt: at('2026-11-07T06:00:00Z'),
      doneAt: at('2026-11-05T10:00:00Z'),
    }), // not due yet but already done: counted, on time
    t({ plannedAt: at('2026-10-28T06:00:00Z'), status: 'DONE', doneAt: at('2026-10-29T06:00:00Z') }), // last week, late
  ];

  it('measures each KPI against what was due so far', () => {
    const lines = scorecard('sandeep', tasks, week, now, { verifySlaMinutes: 60 });
    const by = Object.fromEntries(lines.map((l) => [l.kpi, l]));
    expect(by.notDone).toMatchObject({
      planned: 5,
      actual: 1,
      actualPct: 25,
      lastWeekPct: 0,
      nextTarget: 15,
      state: 'off',
    });
    expect(by.notOnTime).toMatchObject({ actual: 2, actualPct: 50, lastWeekPct: 100, state: 'missedTwice' });
    const ajay = Object.fromEntries(
      scorecard('ajay', tasks, week, now, { verifySlaMinutes: 60 }).map((l) => [l.kpi, l]),
    );
    expect(ajay.verifyPending).toMatchObject({ planned: 2, actual: 0, actualPct: 0, state: 'meets' });
    expect(ajay.verifyLate).toMatchObject({ actual: 1, actualPct: 50 });
    expect(ajay.notDone!.state).toBe('noData');
  });

  it('sets targets and states', () => {
    expect(nextTarget(5, 0)).toBe(0);
    expect(nextTarget(0, 0)).toBe(0);
    expect(nextTarget(null, 0)).toBe(0);
    expect(kpiState(null, 10, 0)).toBe('noData');
    expect(kpiState(0, 50, 0)).toBe('meets');
    expect(kpiState(20, null, 0)).toBe('off');
  });
});

import { parseLocalDateTime, parseTaskRows, splitTable } from './import';

describe('task import', () => {
  const people = [
    { id: 'u1', code: 'EMP-011', name: 'Sandeep Pal', mobile: '+919000000111' },
    { id: 'u2', code: 'EMP-014', name: 'Ajay Meena', mobile: '+919000000114' },
  ];
  const inst = (d: string, m: number) => zonedToUtc(d, m, tz).toISOString();
  it('reads dates the Indian way and Excel serials', () => {
    expect(parseLocalDateTime('05/11/2026 09:30')).toEqual({ date: '2026-11-05', minutes: 570 });
    expect(parseLocalDateTime('5-11-26')).toEqual({ date: '2026-11-05', minutes: 1080 });
    expect(parseLocalDateTime('46331')?.date).toBe('2026-11-05');
    expect(parseLocalDateTime('31/02/2026')).toBeNull();
  });
  it('matches people by code, mobile or name and reports problems per line', () => {
    const rows = splitTable(
      'Doer,Task,Due,Verifier\nEMP-011,"Calibrate press, line 2",05/11/2026,Ajay Meena\n9000000114,Count resin,,\nNobody,Hi,05/11/2026,',
    );
    const out = parseTaskRows(rows, people, inst);
    expect(out[0]).toMatchObject({
      line: 2,
      doerId: 'u1',
      description: 'Calibrate press, line 2',
      verifierId: 'u2',
      errors: [],
    });
    expect(out[0]!.plannedAt).toBe('2026-11-05T12:30:00.000Z');
    expect(out[1]!.errors).toEqual(['Planned date is missing']);
    expect(out[2]!.errors).toEqual(['No person called "Nobody"', 'Task is missing']);
  });
});
