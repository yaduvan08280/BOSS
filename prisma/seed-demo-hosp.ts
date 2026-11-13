import type { Db } from '@mono/db';
import { DEFAULT_HOSP_RULES, gridSpot } from '@mono/shared';

/**
 * Phase 14 demo data: hospitality switched on, a restaurant at the first branch (three stations, a floor of
 * twelve tables), a room type with six rooms, and a small menu — the whisky peg of the stock demo among it.
 * Added once.
 */
export async function seedDemoHosp(db: Db, companyId: string): Promise<boolean> {
  if (await db.outlet.count({ where: { companyId } })) return false;
  const branch = await db.branch.findFirst({
    where: { companyId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (!branch) return false;
  await db.hospSettings.upsert({
    where: { companyId },
    create: { companyId, enabled: true, rules: DEFAULT_HOSP_RULES },
    update: { enabled: true },
  });
  const bar = await db.location.findFirst({
    where: { companyId, branchId: branch.id, name: 'Main bar', deletedAt: null },
  });
  const outlet = await db.outlet.create({
    data: {
      companyId,
      branchId: branch.id,
      name: 'The Courtyard',
      kind: 'RESTAURANT',
      locationId: bar?.id ?? '',
      openMin: 11 * 60,
      closeMin: 23 * 60,
      charges: { serviceChargePct: 5, packagingPaise: 0, deliveryPaise: 0, roundTo: 1, chargeTaxCode: null },
    },
  });
  const stations = await Promise.all(
    [
      ['Kitchen', 'KITCHEN'],
      ['Tandoor', 'TANDOOR'],
      ['Bar', 'BAR'],
    ].map(([name, kind]) =>
      db.station.create({ data: { companyId, outletId: outlet.id, name: name!, kind: kind! } }),
    ),
  );
  await db.kotRoute.createMany({
    data: [
      { companyId, outletId: outlet.id, category: '', stationId: stations[0]!.id },
      { companyId, outletId: outlet.id, category: 'Tandoor', stationId: stations[1]!.id },
      { companyId, outletId: outlet.id, category: 'Drinks', stationId: stations[2]!.id },
    ],
  });
  const floor = await db.floor.create({ data: { companyId, outletId: outlet.id, name: 'Ground floor' } });
  await db.diningTable.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      companyId,
      outletId: outlet.id,
      floorId: floor.id,
      name: `T${i + 1}`,
      seats: i % 4 === 3 ? 6 : 4,
      ...gridSpot(i),
    })),
  });
  const type = await db.roomType.create({
    data: {
      companyId,
      branchId: branch.id,
      name: 'Deluxe',
      code: 'DLX',
      beds: '1 king',
      amenities: ['AC', 'Wi-Fi'],
      tariff: 4500_00n,
    },
  });
  await db.room.createMany({
    data: Array.from({ length: 6 }, (_, i) => ({
      companyId,
      branchId: branch.id,
      typeId: type.id,
      number: String(101 + i),
      floor: '1',
    })),
  });
  const peg = await db.item.findFirst({ where: { companyId, code: 'BAR-PEG-60' } });
  const menu: [string, [string, number, 'VEG' | 'NONVEG', [string, number][]?][]][] = [
    [
      'Starters',
      [
        [
          'Paneer tikka',
          320,
          'VEG',
          [
            ['Half', 180],
            ['Full', 320],
          ],
        ],
        ['Chicken tikka', 380, 'NONVEG'],
      ],
    ],
    [
      'Tandoor',
      [
        ['Butter naan', 60, 'VEG'],
        ['Tandoori roti', 30, 'VEG'],
      ],
    ],
    [
      'Mains',
      [
        ['Dal makhani', 280, 'VEG'],
        [
          'Butter chicken',
          460,
          'NONVEG',
          [
            ['Half', 260],
            ['Full', 460],
          ],
        ],
      ],
    ],
    [
      'Drinks',
      [
        ['Fresh lime soda', 120, 'VEG'],
        ['Royal Oak 60 ml', 450, 'VEG'],
      ],
    ],
  ];
  for (const [i, [name, items]] of menu.entries()) {
    const cat = await db.menuCategory.create({ data: { companyId, name, sort: i } });
    for (const [item, price, diet, variants] of items)
      await db.menuItem.create({
        data: {
          companyId,
          categoryId: cat.id,
          name: item,
          diet,
          price: BigInt(price * 100),
          itemId: item === 'Royal Oak 60 ml' ? (peg?.id ?? null) : null,
          variants: (variants ?? []).map(([v, p]) => ({
            key: v.toLowerCase(),
            name: v,
            price: p * 100,
            factor: v === 'Half' ? 0.5 : 1,
          })),
        },
      });
  }
  return true;
}
