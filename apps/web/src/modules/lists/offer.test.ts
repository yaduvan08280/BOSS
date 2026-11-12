import { describe, expect, it } from 'vitest';
import { fieldSchema } from '@mono/shared';
import { listSlug, listTitle, mayWrite, offerRows, type Offer } from './offer';

const offer = (values: string[], canAdd = false): Offer => ({
  values: values.map((value, i) => ({ value, uses: values.length - i })),
  total: values.length,
  canAdd,
});

describe('value lists in the form', () => {
  it('L2: "Write…" is always the last row, and offers to write exactly what was typed', () => {
    const o = offer(['Rooftop', 'Lawn']);
    // Nothing typed: the values as the server sent them (most used first), then plain "Write…".
    expect(offerRows(o, '', true)).toEqual({ values: o.values, write: { text: '' } });
    // A new text: the last row writes it.
    expect(offerRows(o, '  Pool  side ', true).write).toEqual({ text: 'Pool side' });
    // A text the list already has (whatever the capitals) is picked, not written again.
    expect(offerRows(o, 'rooftop', true).write).toEqual({ text: '' });
    // An empty list still ends in "Write…"; while the list is loading too.
    expect(offerRows(offer([]), '', true)).toEqual({ values: [], write: { text: '' } });
    expect(offerRows(undefined, 'Deck', true)).toEqual({ values: [], write: { text: 'Deck' } });
  });

  it('L5: a list only admins add to shows "Write…" only to people the server lets add', () => {
    const closed = { writeAllowed: false };
    // An open list: everyone writes, even before the server answered.
    expect(mayWrite({}, undefined)).toBe(true);
    expect(mayWrite({ writeAllowed: true }, offer(['Deluxe']))).toBe(true);
    // Closed, with values: a member only picks; an admin (the server says so) still writes.
    expect(mayWrite(closed, offer(['Deluxe']))).toBe(false);
    expect(mayWrite(closed, offer(['Deluxe'], true))).toBe(true);
    expect(offerRows(offer(['Deluxe']), 'Suite', mayWrite(closed, offer(['Deluxe']))).write).toBeNull();
    // Closed but still empty: there is nothing to pick from, so the first value can be typed.
    expect(mayWrite(closed, offer([]))).toBe(true);
    // Never guessed in the browser: no answer yet, no "Write…".
    expect(mayWrite(closed, undefined)).toBe(false);
  });

  it('L3: a shared list name typed in the editor becomes a key the field setting accepts', () => {
    expect(listSlug('Venues')).toBe('venues');
    expect(listSlug('  Room types / beds ')).toBe('room_types_beds');
    expect(listSlug('2 wheelers')).toBe('l_2_wheelers');
    expect(listSlug('शहर')).toBe('');
    expect(listSlug('x'.repeat(60))).toHaveLength(40);
    for (const name of ['Venues', 'Room types / beds', '2 wheelers', `${'ab '.repeat(20)}`]) {
      const field = { key: 'f', label: 'F', type: 'text', learn: true, list: listSlug(name) };
      expect(fieldSchema.safeParse(field).success, name).toBe(true);
    }
    expect(listTitle('room_types')).toBe('Room types');
    expect(listTitle('venues')).toBe('Venues');
  });
});
