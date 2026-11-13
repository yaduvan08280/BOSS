import type { Db } from '@mono/db';
import { DEFAULT_BRANCH_RULES, addDays, localDate } from '@mono/shared';

/**
 * Phase 18 demo data at the demo restaurant's branch: two halls, two menu packages, the bar's licence with the
 * liquor category and a dry day, three licences (one about to run out), pest control every 30 days, and two
 * temperature points. Added once.
 */
export async function seedDemoBanquet(db: Db, companyId: string): Promise<boolean> {
  if (await db.hall.count({ where: { companyId } })) return false;
  const outlet = await db.outlet.findFirst({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!outlet) return false;
  const branchId = outlet.branchId;
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const today = localDate(new Date(), company.timezone);
  await db.hall.createMany({
    data: [
      {
        companyId,
        branchId,
        name: 'Crystal hall',
        capacities: [
          { style: 'Theatre', guests: 300 },
          { style: 'Round tables', guests: 150 },
        ],
        rent: 25000_00n,
      },
      {
        companyId,
        branchId,
        name: 'Garden lawn',
        capacities: [{ style: 'Floating', guests: 500 }],
        rent: 40000_00n,
      },
    ],
  });
  await db.banquetPackage.createMany({
    data: [
      {
        companyId,
        name: 'Silver',
        pricePerPlate: 800_00n,
        items: [
          { name: 'Welcome drink', perCover: 1 },
          { name: 'Veg buffet', perCover: 1 },
        ],
      },
      {
        companyId,
        name: 'Gold',
        pricePerPlate: 1200_00n,
        items: [
          { name: 'Welcome drink', perCover: 1 },
          { name: 'Live counters', perCover: 1 },
        ],
      },
    ],
  });
  const liquor = await db.item.findFirst({ where: { companyId, unit: 'ml', deletedAt: null } });
  await db.branchRule.upsert({
    where: { branchId },
    create: {
      companyId,
      branchId,
      rules: {
        ...DEFAULT_BRANCH_RULES,
        bar: {
          ...DEFAULT_BRANCH_RULES.bar,
          licenceNo: 'DEMO/HBL/2026/001',
          liquorCategories: liquor?.category ? [liquor.category] : ['Liquor'],
          dryDays: [{ date: `${today.slice(0, 4)}-10-02`, reason: 'Gandhi Jayanti' }],
        },
      },
    },
    update: {},
  });
  await db.complianceItem.createMany({
    data: [
      {
        companyId,
        branchId,
        kind: 'FSSAI',
        name: 'FSSAI licence',
        number: '12226999000111',
        expiresOn: addDays(today, 240),
      },
      { companyId, branchId, kind: 'FIRE_NOC', name: 'Fire NOC', expiresOn: addDays(today, 21) },
      {
        companyId,
        branchId,
        kind: 'LIQUOR',
        name: 'Bar licence',
        number: 'DEMO/HBL/2026/001',
        expiresOn: addDays(today, 120),
      },
      {
        companyId,
        branchId,
        kind: 'PEST_CONTROL',
        name: 'Pest control',
        expiresOn: addDays(today, 9),
        everyDays: 30,
        remindDays: [3],
      },
    ],
  });
  await db.tempPoint.createMany({
    data: [
      { companyId, branchId, name: 'Walk-in chiller', min: 0, max: 5 },
      { companyId, branchId, name: 'Deep freezer', max: -18 },
    ],
  });
  return true;
}
