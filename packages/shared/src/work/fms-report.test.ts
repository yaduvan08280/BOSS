import { describe, expect, it } from 'vitest';
import { fmsWeekRow, type FmsStepFact } from './fms-report';
import { misRow } from './mis';

const week = { from: new Date('2026-11-09T00:00:00Z'), to: new Date('2026-11-16T00:00:00Z') };
const now = new Date('2026-11-12T12:00:00Z');
const at = (s: string) => new Date(`2026-11-${s}Z`);
const step = (plannedAt: string, doneAt: string | null, status = doneAt ? 'DONE' : 'OPEN'): FmsStepFact => ({
  status,
  plannedAt: at(plannedAt),
  doneAt: doneAt ? at(doneAt) : null,
});

describe('FMS week report', () => {
  it('grades done steps by their planned time and open ones once they are past it', () => {
    const row = fmsWeekRow(
      [
        step('10T10:00:00', '10T09:00:00'), // on time
        step('10T10:00:00', '11T09:00:00'), // done late
        step('11T10:00:00', null), // open and past due → late
        step('14T10:00:00', null), // open, not due yet
        step('13T10:00:00', null, 'SKIPPED'), // never counts
      ],
      week,
      now,
    );
    expect(row).toEqual({ due: 4, done: 2, onTime: 1, late: 2, open: 1, onTimePct: 33 });
  });

  it('counts early work in the week it is done, and each step only once', () => {
    const early = step('17T10:00:00', '12T09:00:00'); // due next week, done this week
    const lastWeek = step('05T10:00:00', '06T09:00:00'); // done last week: not this week's
    const doneLater = { ...step('10T10:00:00', null), doneAt: new Date('2026-11-17T09:00:00Z') };
    const row = fmsWeekRow([early, lastWeek, doneLater], week, now);
    expect(row).toMatchObject({ due: 1, done: 1, onTime: 1, late: 0, open: 0, onTimePct: 100 });
  });

  it('has no percentage when nothing is graded yet', () => {
    expect(fmsWeekRow([step('15T10:00:00', null)], week, now)).toMatchObject({ open: 1, onTimePct: null });
    expect(fmsWeekRow([], week, now).onTimePct).toBeNull();
  });

  it('feeds the Weekly MIS: FMS steps on time join the score, and no steps leave it alone', () => {
    const steps = [
      { ...step('10T10:00:00', '10T09:00:00'), doerId: 'p1' },
      { ...step('11T10:00:00', null), doerId: 'p1' },
      { ...step('10T10:00:00', '10T09:00:00'), doerId: 'p2' },
    ];
    const row = misRow('p1', { tasks: [], runs: [], tickets: [], steps }, week, now, 60);
    expect(row.fms).toEqual({ total: 2, good: 1, pct: 50 });
    expect(row.score).toBe(50);
    const none = misRow('p3', { tasks: [], runs: [], tickets: [] }, week, now, 60);
    expect(none.fms.pct).toBeNull();
    expect(none.score).toBeNull();
  });
});
