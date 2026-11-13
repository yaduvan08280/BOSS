import { randomBytes } from 'node:crypto';
import type { Db } from '@mono/db';
import { DEFAULT_HOTEL_RULES, addDays, localDate, stayNights } from '@mono/shared';

/**
 * Phase 17 demo data: the demo rooms become a small hotel — its rules and business date, two rate plans (room
 * only, with breakfast), and two bookings (one arriving today, one tomorrow) for guests of the demo. Added once.
 */
export async function seedDemoHotel(db: Db, companyId: string): Promise<boolean> {
  if (await db.ratePlan.count({ where: { companyId } })) return false;
  const type = await db.roomType.findFirst({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!type) return false;
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const today = localDate(new Date(), company.timezone);
  const branchId = type.branchId;
  await db.hotelSettings.upsert({
    where: { branchId },
    create: { companyId, branchId, rules: DEFAULT_HOTEL_RULES, businessDate: today },
    update: {},
  });
  const base = Number(type.tariff ?? 4000_00n);
  const rules = (rate: number) => ({
    rates: [{ roomTypeId: type.id, base: rate, extraAdult: 1000_00, extraChild: 500_00 }],
    weekendDays: [5, 6],
    seasons: [],
    los: [],
    minStay: 1,
    cancel: { freeHours: 24, charge: 'FIRST_NIGHT', pct: 0 },
    noShow: 'FIRST_NIGHT',
  });
  const ep = await db.ratePlan.create({
    data: { companyId, branchId, code: 'EP', name: 'Room only', meal: 'EP', rules: rules(base) },
  });
  const cp = await db.ratePlan.create({
    data: {
      companyId,
      branchId,
      code: 'CP',
      name: 'With breakfast',
      meal: 'CP',
      rules: rules(base + 500_00),
    },
  });
  const guests = await db.guest.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { name: 'asc' },
    take: 2,
  });
  let n = 0;
  for (const [i, g] of guests.entries()) {
    const plan = i === 0 ? cp : ep;
    const arrive = addDays(today, i);
    const depart = addDays(arrive, 2);
    const party =
      (g.partyId && (await db.party.findUnique({ where: { id: g.partyId } }))) ||
      (await db.party.create({
        data: { companyId, code: `GST-D${i + 1}`, name: g.name, mobile: g.mobile, kinds: ['guest'] },
      }));
    if (!g.partyId) await db.guest.update({ where: { id: g.id }, data: { partyId: party.id } });
    const stay = await db.stay.create({
      data: {
        companyId,
        branchId,
        number: `BK-${String(++n).padStart(5, '0')}`,
        guestId: g.id,
        partyId: party.id,
        ratePlanId: plan.id,
        meal: plan.meal,
        roomTypeId: type.id,
        arrive,
        depart,
        adults: 2,
        token: randomBytes(18).toString('base64url'),
      },
    });
    const rate = base + (i === 0 ? 500_00 : 0);
    await db.roomNight.createMany({
      data: stayNights(arrive, depart).map((day) => ({
        companyId,
        branchId,
        roomTypeId: type.id,
        day,
        stayId: stay.id,
        rate: BigInt(rate),
      })),
    });
    await db.folio.create({
      data: { companyId, branchId, stayId: stay.id, no: 1, name: g.name, partyId: party.id },
    });
  }
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'stay', fy: '' } },
    create: { companyId, key: 'stay', fy: '', value: n },
    update: { value: n },
  });
  return true;
}
