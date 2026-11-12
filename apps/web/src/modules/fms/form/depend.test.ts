import { describe, expect, it } from 'vitest';
import type { FlowField } from '@mono/shared';
import { clearDependents, fitsParent, isLockedTarget, lockedTargetsOf } from './depend';

const f = (key: string, more: Partial<FlowField> = {}): FlowField => ({
  key,
  label: key,
  type: 'master',
  required: false,
  ...more,
});
const fields = [
  f('outlet'),
  f('table', { filterBy: { field: 'outlet', column: 'outlet' }, fill: { seats: 'seats', note: 'note' } }),
  f('seat', { filterBy: { field: 'table', column: 'table' } }),
  f('seats', { type: 'number', locked: true }),
  f('note', { type: 'text' }),
];

describe('dependent choices in the form', () => {
  it('L12: changing the outlet empties the table chosen under the old one, and so on down the chain', () => {
    const prev = {
      outlet: 'Rooftop',
      table: 'T1',
      seat: 'A',
      _refs: { outlet: 'row:1', table: 'row:t1', seat: 'row:a' },
    };
    const next = clearDependents(fields, prev, {
      ...prev,
      outlet: 'Lobby',
      _refs: { ...prev._refs, outlet: 'row:2' },
    });
    expect(next).toEqual({ outlet: 'Lobby', _refs: { outlet: 'row:2' } });
    // The same outlet again (or another field changing) leaves the table alone.
    expect(clearDependents(fields, prev, { ...prev, note: 'x' })).toEqual({ ...prev, note: 'x' });
    // The same name but another row is still a change.
    expect(
      clearDependents(fields, prev, { ...prev, _refs: { ...prev._refs, outlet: 'row:9' } }),
    ).not.toHaveProperty('table');
  });

  it('L12: a choice that arrives in the same change as its parent is kept (an auto-fill that brings both)', () => {
    const prev = { outlet: 'Rooftop', table: 'T1' };
    expect(clearDependents(fields, prev, { outlet: 'Lobby', table: 'T9' })).toEqual({
      outlet: 'Lobby',
      table: 'T9',
    });
  });

  it('L12: a row fits its parent by link when both have one, else by text ignoring case and spaces', () => {
    const row = { outlet: 'Rooftop', _refs: { outlet: 'row:1' } };
    expect(fitsParent(row, 'outlet', { value: 'Sky Bar', ref: 'row:1' })).toBe(true); // renamed parent
    expect(fitsParent(row, 'outlet', { value: 'Rooftop', ref: 'row:2' })).toBe(false);
    expect(fitsParent(row, 'outlet', { value: ' rooftop ' })).toBe(true);
    expect(fitsParent({ outlet: 'Lobby' }, 'outlet', { value: 'Rooftop', ref: 'row:1' })).toBe(false);
    expect(fitsParent(undefined, 'outlet', { value: 'Rooftop' })).toBe(false);
  });

  it('L11: only a field that another field fills and that is marked locked is closed to typing', () => {
    expect(isLockedTarget(fields[3]!, fields)).toBe(true);
    expect(isLockedTarget(fields[4]!, fields)).toBe(false); // filled, but not locked
    expect(isLockedTarget(f('alone', { locked: true }), fields)).toBe(false); // locked, but nothing fills it
    expect(lockedTargetsOf(fields[1]!, fields)).toEqual(['seats']);
  });
});
