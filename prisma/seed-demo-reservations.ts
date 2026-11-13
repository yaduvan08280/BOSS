import { randomBytes } from 'node:crypto';
import type { Db } from '@mono/db';
import { DEFAULT_BOOKING, addDays, durationFor, localDate, zonedToUtc } from '@mono/shared';

/**
 * Phase 16 demo data: the demo restaurant takes bookings online (a deposit from eight guests), four guests with
 * what they told us, three bookings for tomorrow evening and one party on the waitlist. Added once.
 */
export async function seedDemoReservations(db: Db, companyId: string): Promise<boolean> {
  if (await db.guest.count({ where: { companyId } })) return false;
  const outlet = await db.outlet.findFirst({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!outlet) return false;
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const tz = company.timezone;
  const booking = { ...DEFAULT_BOOKING, online: true, depositFrom: 8, depositPerHeadPaise: 500_00 };
  await db.outlet.update({
    where: { id: outlet.id },
    data: { booking, bookingToken: outlet.bookingToken ?? randomBytes(18).toString('base64url') },
  });
  const tables = await db.diningTable.findMany({
    where: { companyId, outletId: outlet.id, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  const now = new Date().toISOString();
  const people: [string, string, object][] = [
    [
      'Asha Mehta',
      '+919829011111',
      { allergies: 'Peanuts', preferences: 'Window table', tags: ['VIP'], birthday: '1990-11-20' },
    ],
    [
      'Kabir Rao',
      '+919829022222',
      { tags: ['Regular'], consent: { marketing: true, source: 'STAFF', at: now, byId: null } },
    ],
    ['Neha Jain', '+919829033333', { preferences: 'Less spicy', anniversary: '0000-02-14' }],
    ['Verma family', '+919829044444', {}],
  ];
  const guests = [];
  for (const [name, mobile, more] of people) {
    const consent = (more as { consent?: object }).consent;
    guests.push(
      await db.guest.create({
        data: { companyId, name, mobile, ...more, ...(consent ? { consentLog: [consent] } : {}) },
      }),
    );
  }
  const day = addDays(localDate(new Date(), tz), 1);
  const plan: [number, number, number, string | null][] = [
    [0, 19 * 60, 2, 'Birthday'],
    [1, 19 * 60 + 30, 4, null],
    [2, 20 * 60 + 30, 2, 'Anniversary'],
  ];
  let number = 0;
  for (const [g, startMin, size, occasion] of plan) {
    const table = tables[number];
    if (!table) break;
    const durationMin = durationFor(booking, size);
    const startAt = zonedToUtc(day, startMin, tz);
    await db.reservation.create({
      data: {
        companyId,
        branchId: outlet.branchId,
        outletId: outlet.id,
        number: ++number,
        guestId: guests[g]!.id,
        day,
        startMin,
        durationMin,
        startAt,
        endAt: new Date(startAt.getTime() + durationMin * 60_000),
        partySize: size,
        tableIds: [table.id],
        status: 'CONFIRMED',
        source: 'PHONE',
        occasion,
        token: randomBytes(18).toString('base64url'),
      },
    });
  }
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'reservation', fy: '' } },
    create: { companyId, key: 'reservation', fy: '', value: number },
    update: { value: number },
  });
  await db.waitlistEntry.create({
    data: {
      companyId,
      branchId: outlet.branchId,
      outletId: outlet.id,
      guestId: guests[3]!.id,
      name: 'Verma family',
      mobile: '+919829044444',
      partySize: 5,
      quotedMin: 20,
    },
  });
  return true;
}
