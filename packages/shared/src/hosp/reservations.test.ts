import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOKING,
  bookingPatchSchema,
  depositFor,
  depositOutcome,
  durationFor,
  fitTables,
  guestMobile,
  quoteWait,
  slotLabel,
  slotsOf,
  type FitTable,
} from './reservations';
import { tableState } from './pos';
import { reservationMachine, waitlistMachine } from '../machines/reservation';
import { transition } from '../machines/transition';

const t = (id: string, seats: number, combinable = false, floorId = 'f1'): FitTable => ({
  id,
  name: id,
  seats,
  combinable,
  floorId,
});
const go = (from: string, action: string, role: string, ctx = { depositDue: false, pastHold: false }) =>
  transition(reservationMachine, {
    from: from as 'REQUESTED',
    action: action as 'confirm',
    roles: [role as 'staff'],
    ctx,
  }).to;

describe('booking rules (R1)', () => {
  it('has defaults, and a patch carries none', () => {
    expect(DEFAULT_BOOKING.slotMin).toBe(30);
    expect(bookingPatchSchema.parse({ holdMin: 20 })).toEqual({ holdMin: 20 });
  });
  it('a party stays as long as its size says', () => {
    expect(durationFor(DEFAULT_BOOKING, 2)).toBe(90);
    expect(durationFor(DEFAULT_BOOKING, 3)).toBe(120);
    expect(durationFor(DEFAULT_BOOKING, 12)).toBe(180);
    expect(durationFor({ durations: [{ upTo: 4, minutes: 100 }] }, 9)).toBe(100);
  });
  it('gives the slots of a day, past midnight too', () => {
    expect(slotsOf({ slotMin: 30, fromMin: null, toMin: null }, 12 * 60, 15 * 60)).toEqual([
      720, 750, 780, 810, 840, 870,
    ]);
    const late = slotsOf({ slotMin: 60, fromMin: null, toMin: null }, 22 * 60, 60);
    expect(late).toEqual([1320, 1380, 1440]);
    expect(late.map(slotLabel)).toEqual(['22:00', '23:00', '00:00']);
    expect(slotsOf({ slotMin: 30, fromMin: 19 * 60, toMin: 20 * 60 }, 0, 1440)).toEqual([1140, 1170, 1200]);
  });
  it('reads mobiles as E.164', () => {
    expect(guestMobile.parse('98290 12345')).toBe('+919829012345');
    expect(guestMobile.parse('+971 50 123 4567')).toBe('+971501234567');
    expect(guestMobile.safeParse('12').success).toBe(false);
  });
});

describe('best fit (R4)', () => {
  const tables = [
    t('T1', 2),
    t('T2', 4),
    t('T3', 4, true),
    t('T4', 4, true),
    t('T5', 6, true),
    t('U1', 4, true, 'f2'),
  ];
  it('takes the smallest table that seats the party', () => {
    expect(fitTables(tables, 2, new Set())).toEqual(['T1']);
    expect(fitTables(tables, 3, new Set())).toEqual(['T2']);
    expect(fitTables(tables, 3, new Set(['T2']))).toEqual(['T3']);
    expect(fitTables(tables, 6, new Set())).toEqual(['T5']);
  });
  it('joins tables of one floor: the fewest, then the fewest spare seats', () => {
    expect(fitTables(tables, 8, new Set())).toEqual(['T3', 'T4']);
    expect(fitTables(tables, 9, new Set())?.sort()).toEqual(['T3', 'T5']);
    expect(fitTables(tables, 14, new Set())?.sort()).toEqual(['T3', 'T4', 'T5']);
    // Never across floors, never a table that does not join.
    expect(fitTables(tables, 15, new Set())).toBeNull();
    expect(fitTables([t('A', 4), t('B', 4)], 6, new Set())).toBeNull();
  });
});

describe('deposits (R11, R14, R15)', () => {
  const b = { ...DEFAULT_BOOKING, depositFrom: 8, depositPerHeadPaise: 500_00 };
  it('asks large parties only', () => {
    expect(depositFor(b, 7)).toBe(0);
    expect(depositFor(b, 10)).toBe(5000_00);
    expect(depositFor(DEFAULT_BOOKING, 40)).toBe(0);
  });
  it('comes back when cancelled in time; a no-show follows the rule', () => {
    expect(depositOutcome(b, 'CANCEL', 5)).toBe('REFUND');
    expect(depositOutcome(b, 'CANCEL', 2)).toBe('KEEP');
    expect(depositOutcome(b, 'NO_SHOW', 0)).toBe('KEEP');
    expect(depositOutcome({ ...b, noShowDeposit: 'REFUND' }, 'NO_SHOW', 0)).toBe('REFUND');
  });
});

describe('the wait quoted (R17)', () => {
  const now = Date.UTC(2026, 10, 13, 14, 0);
  const min = (n: number) => now + n * 60_000;
  it('is when the table the party needs comes free', () => {
    expect(quoteWait(now, [], 0, 90)).toBeNull();
    expect(quoteWait(now, [now - 1000], 0, 90)).toBe(0);
    expect(quoteWait(now, [min(22), min(48)], 0, 90)).toBe(25);
    expect(quoteWait(now, [min(22), min(48)], 1, 90)).toBe(50);
    // Two ahead on two tables: the first table must turn again.
    expect(quoteWait(now, [min(22), min(48)], 2, 90)).toBe(115);
  });
});

describe('reservation machine (R7)', () => {
  it('walks the happy path', () => {
    expect(go('REQUESTED', 'confirm', 'staff')).toBe('CONFIRMED');
    expect(go('CONFIRMED', 'remind', 'system')).toBe('REMINDED');
    expect(go('REMINDED', 'arrive', 'staff')).toBe('ARRIVED');
    expect(go('ARRIVED', 'seat', 'staff')).toBe('SEATED');
    expect(go('CONFIRMED', 'seat', 'staff')).toBe('SEATED');
    expect(go('SEATED', 'finish', 'system')).toBe('FINISHED');
  });
  it('waits for the deposit, cancels until seated, and knows a no-show', () => {
    expect(() => go('REQUESTED', 'confirm', 'staff', { depositDue: true, pastHold: false })).toThrow();
    expect(go('CONFIRMED', 'cancel', 'guest')).toBe('CANCELLED');
    expect(() => go('SEATED', 'cancel', 'staff')).toThrow();
    expect(() => go('CONFIRMED', 'noShow', 'system')).toThrow();
    expect(go('CONFIRMED', 'noShow', 'system', { depositDue: false, pastHold: true })).toBe('NO_SHOW');
    expect(go('REMINDED', 'noShow', 'staff')).toBe('NO_SHOW');
    expect(go('NO_SHOW', 'restore', 'staff')).toBe('CONFIRMED');
    expect(() => go('CANCELLED', 'confirm', 'staff')).toThrow();
    expect(() => go('CONFIRMED', 'seat', 'guest')).toThrow();
  });
  it('the waitlist: waiting, called, seated or left', () => {
    const w = (from: string, action: string) =>
      transition(waitlistMachine, {
        from: from as 'WAITING',
        action: action as 'call',
        roles: ['staff'],
        ctx: {},
      }).to;
    expect(w('WAITING', 'call')).toBe('CALLED');
    expect(w('CALLED', 'seat')).toBe('SEATED');
    expect(w('WAITING', 'leave')).toBe('LEFT');
    expect(() => w('LEFT', 'seat')).toThrow();
  });
});

describe('the floor (R13)', () => {
  it('shows a free table with a booking due as reserved; an order wins', () => {
    expect(tableState(null, true)).toBe('RESERVED');
    expect(tableState(null)).toBe('FREE');
    expect(tableState({ status: 'OPEN', fired: 0 }, true)).toBe('SEATED');
  });
});
