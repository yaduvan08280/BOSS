import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOTEL_RULES,
  auditStats,
  cancelCharge,
  earlyFee,
  formCMissing,
  isForeign,
  lateFee,
  nightRate,
  noShowCharge,
  quoteStay,
  ratePlanSchema,
  restriction,
  roomState,
  routeFolio,
  stayNights,
} from './hotel';
import { hkTaskMachine, roomHkMachine, stayMachine } from '../machines/hotel';
import { transition } from '../machines/transition';

const plan = ratePlanSchema.parse({
  branchId: 'b',
  code: 'CP',
  name: 'With breakfast',
  meal: 'CP',
  rates: [{ roomTypeId: 'dlx', base: 4000_00, weekend: 5000_00, extraAdult: 800_00, extraChild: 400_00 }],
  seasons: [{ name: 'Diwali', from: '2026-11-06', to: '2026-11-10', pct: 25 }],
  los: [
    { nights: 3, pctOff: 10 },
    { nights: 7, pctOff: 20 },
  ],
  cancel: { freeHours: 48, charge: 'PERCENT', pct: 50 },
});
const two = { adults: 2, children: 0, occupancy: 2 };

describe('rates (H1–H3, H6)', () => {
  it('a night: base or weekend, the season, extra guests, the length of stay', () => {
    // Monday 16/11/2026, one night.
    expect(nightRate(plan, 'dlx', '2026-11-16', two, 1)).toBe(4000_00);
    // Friday and Saturday nights are the weekend.
    expect(nightRate(plan, 'dlx', '2026-11-20', two, 1)).toBe(5000_00);
    expect(nightRate(plan, 'dlx', '2026-11-22', two, 1)).toBe(4000_00);
    // Diwali week: +25 %.
    expect(nightRate(plan, 'dlx', '2026-11-09', two, 1)).toBe(5000_00);
    // A third adult and a child.
    expect(nightRate(plan, 'dlx', '2026-11-16', { adults: 3, children: 1, occupancy: 2 }, 1)).toBe(5200_00);
    // Three nights and more: 10 % off; a week: 20 %.
    expect(nightRate(plan, 'dlx', '2026-11-16', two, 3)).toBe(3600_00);
    expect(nightRate(plan, 'dlx', '2026-11-16', two, 8)).toBe(3200_00);
    expect(nightRate(plan, 'suite', '2026-11-16', two, 1)).toBeNull();
  });
  it('quotes a stay night by night', () => {
    expect(stayNights('2026-11-19', '2026-11-22')).toEqual(['2026-11-19', '2026-11-20', '2026-11-21']);
    const q = quoteStay(plan, 'dlx', '2026-11-19', '2026-11-22', two)!;
    expect(q.nights.map((n) => n.rate)).toEqual([3600_00, 4500_00, 4500_00]);
    expect(q.total).toBe(12600_00);
    expect(quoteStay(plan, 'suite', '2026-11-19', '2026-11-22', two)).toBeNull();
  });
  it('knows what stops a sale', () => {
    const rules = new Map([
      ['2026-12-24', { closedToArrival: true }],
      ['2026-12-31', { stopSell: true }],
      ['2026-12-26', { minStay: 3 }],
    ]);
    expect(restriction('2026-12-20', '2026-12-22', rules)).toBeNull();
    expect(restriction('2026-12-24', '2026-12-26', rules)).toBe('CLOSED_TO_ARRIVAL');
    expect(restriction('2026-12-23', '2026-12-26', rules)).toBeNull();
    expect(restriction('2026-12-30', '2027-01-02', rules)).toBe('STOP_SELL');
    expect(restriction('2026-12-26', '2026-12-28', rules)).toBe('MIN_STAY');
    expect(restriction('2026-12-26', '2026-12-29', rules)).toBeNull();
    expect(restriction('2026-12-20', '2026-12-21', rules, 2)).toBe('MIN_STAY');
  });
});

describe('charges (H14, H15, H22)', () => {
  const nights = [
    { day: 'a', rate: 4000_00 },
    { day: 'b', rate: 5000_00 },
  ];
  it('cancelling: free in time, then by the plan', () => {
    expect(cancelCharge(plan.cancel, nights, 60)).toBe(0);
    expect(cancelCharge(plan.cancel, nights, 10)).toBe(4500_00);
    expect(cancelCharge({ freeHours: 24, charge: 'FIRST_NIGHT', pct: 0 }, nights, 1)).toBe(4000_00);
    expect(cancelCharge({ freeHours: 24, charge: 'FULL', pct: 0 }, nights, 1)).toBe(9000_00);
    expect(cancelCharge({ freeHours: 24, charge: 'NONE', pct: 0 }, nights, 1)).toBe(0);
  });
  it('a no-show', () => {
    expect(noShowCharge('FIRST_NIGHT', nights)).toBe(4000_00);
    expect(noShowCharge('FULL', nights)).toBe(9000_00);
    expect(noShowCharge('NONE', nights)).toBe(0);
  });
  it('early check-in and late check-out', () => {
    const r = { ...DEFAULT_HOTEL_RULES, earlyFeePct: 50, lateFeePct: 50 };
    expect(earlyFee(r, 14 * 60, 4000_00)).toBe(0);
    expect(earlyFee(r, 13 * 60 + 40, 4000_00)).toBe(0);
    expect(earlyFee(r, 8 * 60, 4000_00)).toBe(2000_00);
    expect(lateFee(r, 11 * 60 + 20, 5000_00)).toBe(0);
    expect(lateFee(r, 14 * 60, 5000_00)).toBe(2500_00);
    expect(lateFee(r, 19 * 60, 5000_00)).toBe(5000_00);
    expect(earlyFee(DEFAULT_HOTEL_RULES, 6 * 60, 4000_00)).toBe(0);
    expect(lateFee(DEFAULT_HOTEL_RULES, 19 * 60, 4000_00)).toBe(0);
  });
});

describe('Form C, routing, the audit figures, room states (H19, H30, H40, H41)', () => {
  it('a foreign guest needs the passport, visa and travel details', () => {
    expect(isForeign('Indian')).toBe(false);
    expect(isForeign('British')).toBe(true);
    expect(formCMissing({ nationality: 'Indian' })).toEqual([]);
    expect(formCMissing({ nationality: 'British', passportNo: 'P1', visaNo: 'V1' })).toEqual([
      'visaExpiry',
      'arrivedIndiaOn',
      'arrivedFrom',
      'nextDestination',
      'purpose',
    ]);
  });
  it('routes kinds of charge to a folio', () => {
    const routing = [{ kinds: ['ROOM' as const, 'EARLY' as const], folio: 2 }];
    expect(routeFolio(routing, 'ROOM')).toBe(2);
    expect(routeFolio(routing, 'FOOD')).toBe(1);
    expect(routeFolio(null, 'ROOM')).toBe(1);
  });
  it('occupancy, ADR and RevPAR', () => {
    expect(auditStats({ rooms: 10, outOfOrder: 2, sold: 6, roomRevenue: 27000_00 })).toEqual({
      sellable: 8,
      occupancyPct: 75,
      adr: 4500_00,
      revPar: 3375_00,
    });
    expect(auditStats({ rooms: 0, outOfOrder: 0, sold: 0, roomRevenue: 0 }).adr).toBe(0);
  });
  it('what the board shows', () => {
    expect(roomState('CLEAN', false)).toBe('VACANT_CLEAN');
    expect(roomState('DIRTY', false)).toBe('VACANT_DIRTY');
    expect(roomState('DIRTY', true)).toBe('OCCUPIED_DIRTY');
    expect(roomState('INSPECTED', true)).toBe('OCCUPIED');
    expect(roomState('OUT_OF_ORDER', false)).toBe('OUT_OF_ORDER');
  });
});

describe('machines (H18, H35, H41, H43)', () => {
  const stay = (
    from: string,
    action: string,
    ctx = { room: true, kyc: true, settled: true },
    role = 'desk',
  ) =>
    transition(stayMachine, {
      from: from as 'BOOKED',
      action: action as 'checkIn',
      roles: [role as 'desk'],
      ctx,
    }).to;
  it('a stay', () => {
    expect(stay('BOOKED', 'checkIn')).toBe('CHECKED_IN');
    expect(() => stay('BOOKED', 'checkIn', { room: false, kyc: true, settled: true })).toThrow();
    expect(() => stay('BOOKED', 'checkIn', { room: true, kyc: false, settled: true })).toThrow();
    expect(() => stay('CHECKED_IN', 'checkOut', { room: true, kyc: true, settled: false })).toThrow();
    expect(stay('CHECKED_IN', 'checkOut')).toBe('CHECKED_OUT');
    expect(stay('BOOKED', 'noShow', undefined, 'system')).toBe('NO_SHOW');
    expect(stay('NO_SHOW', 'reinstate')).toBe('BOOKED');
    expect(() => stay('CHECKED_IN', 'cancel')).toThrow();
    expect(() => stay('CANCELLED', 'checkIn')).toThrow();
  });
  it('a room and its cleaning', () => {
    const hk = (from: string, action: string, role = 'supervisor', service = false) =>
      transition(roomHkMachine, {
        from: from as 'DIRTY',
        action: action as 'clean',
        roles: [role as 'attendant'],
        ctx: { service },
      }).to;
    expect(hk('DIRTY', 'clean', 'attendant')).toBe('CLEAN');
    expect(() => hk('CLEAN', 'inspect', 'attendant')).toThrow();
    expect(hk('CLEAN', 'inspect')).toBe('INSPECTED');
    expect(hk('INSPECTED', 'fail')).toBe('DIRTY');
    expect(hk('CLEAN', 'block')).toBe('OUT_OF_ORDER');
    expect(hk('CLEAN', 'block', 'supervisor', true)).toBe('OUT_OF_SERVICE');
    expect(hk('OUT_OF_ORDER', 'release', 'system')).toBe('DIRTY');
    expect(() => hk('OUT_OF_ORDER', 'clean')).toThrow();
    const task = (from: string, action: string, ticked = true, role = 'supervisor') =>
      transition(hkTaskMachine, {
        from: from as 'OPEN',
        action: action as 'done',
        roles: [role as 'attendant'],
        ctx: { ticked },
      }).to;
    expect(() => task('OPEN', 'done', false, 'attendant')).toThrow();
    expect(task('OPEN', 'done', true, 'attendant')).toBe('DONE');
    expect(() => task('DONE', 'inspect', true, 'attendant')).toThrow();
    expect(task('DONE', 'redo')).toBe('OPEN');
    expect(task('DONE', 'inspect')).toBe('INSPECTED');
  });
});
