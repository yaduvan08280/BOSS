import { describe, expect, it } from 'vitest';
import { ticketEscalation } from './escalation';
import { misRow, type MisTask } from './mis';
import { weekOf } from './calendar';

const at = (iso: string) => new Date(iso);
const s = { escalationLevels: 2, firstReplyHours: 4, fixHours: 24 };

describe('ticket escalation', () => {
  const raised = at('2026-11-02T04:00:00Z');
  const t = {
    status: 'OPEN',
    createdAt: raised,
    firstReplyAt: null,
    plannedFixAt: at('2026-11-03T04:00:00Z'),
  };

  it('no reply: level 1 at 4 h, level 2 at 8 h', () => {
    expect(ticketEscalation(t, s, at('2026-11-02T07:59:00Z')).level).toBe(0);
    expect(ticketEscalation(t, s, at('2026-11-02T08:00:00Z'))).toEqual({ level: 1, reason: 'noReply' });
    expect(ticketEscalation(t, s, at('2026-11-02T12:00:00Z'))).toEqual({ level: 2, reason: 'noReply' });
  });

  it('replied but late: level 1 at the planned fix, level 2 a fix-time later', () => {
    const replied = { ...t, status: 'IN_PROGRESS', firstReplyAt: at('2026-11-02T05:00:00Z') };
    expect(ticketEscalation(replied, s, at('2026-11-02T12:00:00Z')).level).toBe(0);
    expect(ticketEscalation(replied, s, at('2026-11-03T04:00:00Z'))).toEqual({ level: 1, reason: 'late' });
    expect(ticketEscalation(replied, s, at('2026-11-04T04:00:00Z'))).toEqual({ level: 2, reason: 'late' });
  });

  it('respects the level setting and finished tickets', () => {
    expect(ticketEscalation(t, { ...s, escalationLevels: 1 }, at('2026-11-02T12:00:00Z')).level).toBe(1);
    expect(ticketEscalation(t, { ...s, escalationLevels: 0 }, at('2026-11-05T00:00:00Z')).level).toBe(0);
    expect(ticketEscalation({ ...t, status: 'RESOLVED' }, s, at('2026-11-05T00:00:00Z')).level).toBe(0);
  });
});

describe('weekly MIS', () => {
  // Week Mon 02/11 – Sun 08/11/2026 IST, read on Thursday 05/11 18:00 IST.
  const week = weekOf(at('2026-11-04T06:00:00Z'), 'Asia/Kolkata');
  const now = at('2026-11-05T12:30:00Z');
  const task = (o: Partial<MisTask>): MisTask => ({
    doerId: 'gopal',
    verifierId: 'ajay',
    status: 'OPEN',
    plannedAt: at('2026-11-03T12:30:00Z'),
    doneAt: null,
    verifiedAt: null,
    ...o,
  });
  const data = {
    tasks: [
      task({ status: 'DONE', doneAt: at('2026-11-03T10:00:00Z'), verifiedAt: at('2026-11-03T10:30:00Z') }),
      task({
        status: 'DONE',
        plannedAt: at('2026-11-04T06:00:00Z'),
        doneAt: at('2026-11-04T09:00:00Z'),
        verifiedAt: at('2026-11-04T12:00:00Z'),
      }),
      task({ plannedAt: at('2026-11-05T06:00:00Z') }),
      task({ plannedAt: at('2026-11-07T06:00:00Z') }),
      task({ status: 'CANCELLED', plannedAt: at('2026-11-03T06:00:00Z') }),
    ],
    runs: [
      { doerId: 'gopal', plannedAt: at('2026-11-02T04:00:00Z'), status: 'DONE' },
      { doerId: 'gopal', plannedAt: at('2026-11-03T04:00:00Z'), status: 'MISSED' },
      { doerId: 'gopal', plannedAt: at('2026-11-06T04:00:00Z'), status: 'OPEN' },
    ],
    tickets: [
      {
        solverId: 'gopal',
        status: 'CLOSED',
        plannedFixAt: at('2026-11-03T06:00:00Z'),
        resolvedAt: at('2026-11-03T05:00:00Z'),
      },
      {
        solverId: 'gopal',
        status: 'IN_PROGRESS',
        plannedFixAt: at('2026-11-04T06:00:00Z'),
        resolvedAt: null,
      },
    ],
  };

  it('counts what was due, by module, with one overall score', () => {
    const row = misRow('gopal', data, week, now, 60);
    expect(row.tasks).toEqual({
      planned: 4,
      done: { total: 3, good: 2, pct: 67 },
      onTime: { total: 3, good: 1, pct: 33 },
    });
    expect(row.checklists).toEqual({ total: 2, good: 1, pct: 50 });
    expect(row.tickets).toEqual({ total: 2, good: 1, pct: 50 });
    expect(row.verifications.total).toBe(0);
    expect(row.score).toBe(50); // (67 + 33 + 50 + 50) / 4
    const ajay = misRow('ajay', data, week, now, 60);
    expect(ajay.verifications).toEqual({ total: 2, good: 1, pct: 50 });
    expect(ajay.score).toBe(50);
  });
});
