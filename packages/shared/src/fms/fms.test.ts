import { describe, expect, it } from 'vitest';
import { zonedToUtc } from '../work/calendar';
import { flowDefinitionSchema, type FlowDefinition } from './definition';
import { checkFields, itemsTotal, recordTitle } from './fields';
import { mainPathHours, nextStepKey, readiness, validateFlow } from './flow';
import { addWorkingMinutes, nextWorkingStart, plannedAt, type WorkCalendar } from './worktime';

const TZ = 'Asia/Kolkata';
const at = (date: string, hhmm: string) =>
  zonedToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
// General shift 09:00–19:00, Monday–Saturday; Tuesday 03/11/2026 is a holiday. Monday = 02/11/2026.
const general: WorkCalendar = {
  tz: TZ,
  shift: { start: 540, end: 1140, weekdays: [1, 2, 3, 4, 5, 6] },
  holidays: new Set(['2026-11-03']),
};
const night: WorkCalendar = {
  tz: TZ,
  shift: { start: 1380, end: 420, weekdays: [1, 2, 3, 4, 5, 6] },
  holidays: new Set(),
};

describe('working time (shift hours only)', () => {
  it('adds inside one shift', () => {
    expect(addWorkingMinutes(at('2026-11-02', '10:00'), 240, general)).toEqual(at('2026-11-02', '14:00'));
  });
  it('carries over to the next working day, skipping holidays', () => {
    // 2 h on Monday, Tuesday is a holiday, 2 h on Wednesday.
    expect(addWorkingMinutes(at('2026-11-02', '17:00'), 240, general)).toEqual(at('2026-11-04', '11:00'));
  });
  it('skips the weekly off', () => {
    expect(addWorkingMinutes(at('2026-11-07', '18:00'), 120, general)).toEqual(at('2026-11-09', '10:00'));
  });
  it('starts counting at the shift start when given before it', () => {
    expect(addWorkingMinutes(at('2026-11-02', '07:00'), 60, general)).toEqual(at('2026-11-02', '10:00'));
    expect(addWorkingMinutes(at('2026-11-02', '20:00'), 60, general)).toEqual(at('2026-11-04', '10:00'));
  });
  it('handles night shifts across midnight', () => {
    expect(addWorkingMinutes(at('2026-11-02', '23:30'), 120, night)).toEqual(at('2026-11-03', '01:30'));
    // Tuesday 06:00 is still Monday's shift: 1 h left, then Tuesday night's shift.
    expect(addWorkingMinutes(at('2026-11-03', '06:00'), 120, night)).toEqual(at('2026-11-04', '00:00'));
  });
  it('finds the next working moment', () => {
    expect(nextWorkingStart(at('2026-11-03', '12:00'), general)).toEqual(at('2026-11-04', '09:00'));
    expect(nextWorkingStart(at('2026-11-02', '12:00'), general)).toEqual(at('2026-11-02', '12:00'));
  });
});

describe('planned time of a step', () => {
  const base = {
    previousDoneAt: at('2026-11-02', '11:00'),
    recordStartedAt: at('2026-11-02', '09:30'),
    data: { delivery: '2026-11-20' },
    calendar: general,
    timeModel: 'shifts' as const,
  };
  it('after the previous step, in hours or working days', () => {
    expect(plannedAt({ value: 2, unit: 'hours', anchor: 'previous' }, base)).toEqual(
      at('2026-11-02', '13:00'),
    );
    // 1 working day = one shift (10 h); Tuesday is a holiday.
    expect(plannedAt({ value: 1, unit: 'days', anchor: 'previous' }, base)).toEqual(
      at('2026-11-04', '11:00'),
    );
  });
  it('after the record started', () => {
    expect(plannedAt({ value: 30, unit: 'minutes', anchor: 'start' }, base)).toEqual(
      at('2026-11-02', '10:00'),
    );
  });
  it('at a fixed time on the next working day when it has passed', () => {
    expect(plannedAt({ value: 0, unit: 'hours', anchor: 'fixed', at: '10:00' }, base)).toEqual(
      at('2026-11-04', '10:00'),
    );
    expect(plannedAt({ value: 0, unit: 'hours', anchor: 'fixed', at: '16:00' }, base)).toEqual(
      at('2026-11-02', '16:00'),
    );
  });
  it('before a date field', () => {
    expect(
      plannedAt(
        { value: 2, unit: 'days', anchor: 'dateField', field: 'delivery', before: true },
        { ...base, timeModel: 'calendar' },
      ),
    ).toEqual(at('2026-11-18', '09:00'));
  });
  it('full calendar ignores shifts and holidays', () => {
    expect(
      plannedAt({ value: 1, unit: 'days', anchor: 'previous' }, { ...base, timeModel: 'calendar' }),
    ).toEqual(at('2026-11-03', '11:00'));
  });
});

const flow = (steps: object[]): FlowDefinition => flowDefinitionSchema.parse({ steps });
const t = { value: 1, unit: 'hours', anchor: 'previous' };

describe('flow rules', () => {
  const ok = flow([
    { key: 'take', name: 'Take order', type: 'TASK', doerIds: ['a'], time: t },
    {
      key: 'stock',
      name: 'In stock?',
      type: 'DECISION',
      doerIds: ['b'],
      time: t,
      yes: 'dispatch',
      no: 'buy',
    },
    {
      key: 'buy',
      name: 'Buy material',
      type: 'TASK',
      doerIds: ['c'],
      time: { value: 2, unit: 'days', anchor: 'previous' },
    },
    { key: 'ok', name: 'Manager OK', type: 'APPROVAL', doerIds: ['d'], time: t },
    {
      key: 'dispatch',
      name: 'Dispatch',
      type: 'TASK',
      doerIds: ['e'],
      time: { value: 4, unit: 'hours', anchor: 'previous' },
    },
    { key: 'mail', name: 'Send invoice', type: 'AUTO', auto: { action: 'message', text: 'Sent' } },
  ]);
  it('a complete flow has no issues', () => {
    expect(validateFlow(ok, new Set(['a', 'b', 'c', 'd', 'e']))).toEqual([]);
  });
  it('branches: decisions, approvals, the end', () => {
    expect(nextStepKey(ok, 'stock', 'yes')).toBe('dispatch');
    expect(nextStepKey(ok, 'stock', 'no')).toBe('buy');
    expect(nextStepKey(ok, 'ok', 'approved')).toBe('dispatch');
    expect(nextStepKey(ok, 'ok', 'rejected')).toBe('buy');
    expect(nextStepKey(ok, 'mail')).toBe('end');
  });
  it('flags what blocks publishing', () => {
    const bad = flow([
      { key: 'a', name: 'A', type: 'TASK', doerIds: [], time: t },
      { key: 'b', name: 'B', type: 'DECISION', doerIds: ['x'], time: t, yes: 'end' },
      { key: 'c', name: 'C', type: 'TASK', doerIds: ['x'], next: 'zz' },
    ]);
    const codes = validateFlow(bad, new Set(['y'])).map((i) => `${i.code}:${i.stepKey ?? ''}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'noDoer:a',
        'decisionBranches:b',
        'noTime:c',
        'unknownTarget:c',
        'unknownPerson:b',
        'orphan:c',
      ]),
    );
  });
  it('a loop with no way out never ends', () => {
    const loop = flow([
      { key: 'a', name: 'A', type: 'TASK', doerIds: ['x'], time: t, next: 'b' },
      { key: 'b', name: 'B', type: 'TASK', doerIds: ['x'], time: t, next: 'a' },
    ]);
    expect(validateFlow(loop).map((i) => i.code)).toContain('noEnd');
  });
  it('start to end along the main path, and readiness', () => {
    // 1 h + 1 h + (Yes → dispatch) 4 h + auto 0 = 6 h
    expect(mainPathHours(ok, 8)).toBe(6);
    const r = readiness(ok, { coordinatorId: 'a', solverId: null, videoUrl: null }, 1);
    expect(r).toMatchObject({
      score: 3,
      of: 5,
      checks: { steps: true, coordinator: true, solver: false, kpi: true, video: false },
    });
  });
});

describe('form fields', () => {
  const fields = flowDefinitionSchema.parse({
    startFields: [
      { key: 'customer', label: 'Customer', type: 'text', required: true },
      { key: 'mobile', label: 'Mobile', type: 'mobile', required: true },
      { key: 'qty', label: 'Slabs', type: 'number' },
      { key: 'colour', label: 'Colour', type: 'dropdown', options: ['Statuario', 'Carrara'] },
      { key: 'delivery', label: 'Delivery', type: 'date' },
      { key: 'lines', label: 'Items', type: 'items' },
      { key: 'urgent', label: 'Urgent?', type: 'yesno' },
    ],
  }).startFields;
  it('cleans good input', () => {
    const r = checkFields(fields, {
      customer: ' Sharma Builders ',
      mobile: '98290 12345',
      qty: '12',
      colour: 'Carrara',
      delivery: '2026-11-20',
      lines: [
        { item: 'Carrara 20mm', qty: '10', rate: '4500.5' },
        { item: '', qty: '' },
      ],
      urgent: false,
    });
    expect(r.errors).toEqual({});
    expect(r.values).toMatchObject({
      customer: 'Sharma Builders',
      mobile: '+919829012345',
      qty: 12,
      urgent: false,
    });
    expect(r.values.lines).toEqual([{ item: 'Carrara 20mm', qty: 10, rate: 4500.5, amount: 45005 }]);
    expect(itemsTotal(r.values)).toBe(45005);
    expect(recordTitle(fields, r.values, 'Order', 7)).toBe('Sharma Builders');
  });
  it('names every problem', () => {
    const r = checkFields(fields, {
      mobile: '12345',
      qty: 'twelve',
      colour: 'Black',
      delivery: '20/11/2026',
      lines: [{ item: 'X', qty: 0 }],
    });
    expect(Object.keys(r.errors).sort()).toEqual([
      'colour',
      'customer',
      'delivery',
      'lines',
      'mobile',
      'qty',
    ]);
    expect(recordTitle(fields, {}, 'Order', 7)).toBe('Order #7');
  });
});
