import type { Db } from '@mono/db';

/**
 * Phase 13 demo data: a store and a bar at the company's first branch, a whisky kept in ml (bottle, case and
 * peg units) with a few bottles at the bar, a 60 ml peg sold through its recipe, a par level and a gold rate on
 * the board. Added once; nothing from earlier phases is changed (their stock stays in the main store).
 */
export async function seedDemoStock(db: Db, companyId: string): Promise<boolean> {
  if (await db.recipe.count({ where: { companyId } })) return false;
  const branch = await db.branch.findFirst({
    where: { companyId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (!branch) return false;
  const place = (name: string, kind: string) =>
    db.location.create({ data: { companyId, branchId: branch.id, name, kind } });
  const store = await place('Liquor store', 'STORE');
  const bar = await place('Main bar', 'BAR');
  const whisky = await db.item.create({
    data: {
      companyId,
      code: 'BAR-WH-01',
      name: 'Royal Oak whisky',
      unit: 'ml',
      category: 'Liquor',
      brand: 'Royal Oak',
      purchaseUnit: 'case',
      units: [
        { unit: 'bottle', factor: 750 },
        { unit: 'case', factor: 9000 },
        { unit: 'peg', factor: 30, serve: true },
      ],
      rate: 133n,
      stock: 9000 + 2250,
    },
  });
  await db.stockBalance.createMany({
    data: [
      { companyId, itemId: whisky.id, locationId: store.id, qty: 9000, value: 12_000_00n },
      { companyId, itemId: whisky.id, locationId: bar.id, qty: 2250, value: 3_000_00n },
    ],
  });
  const peg = await db.item.create({
    data: {
      companyId,
      code: 'BAR-PEG-60',
      name: 'Royal Oak 60 ml',
      unit: 'peg',
      category: 'Liquor',
      made: 'DISH',
      sellPrice: 450_00n,
    },
  });
  await db.recipe.create({
    data: {
      companyId,
      itemId: peg.id,
      lines: [{ itemId: whisky.id, qty: 2, unit: 'peg', yieldPct: 100, wastagePct: 0 }],
    },
  });
  await db.parLevel.create({
    data: { companyId, itemId: whisky.id, locationId: bar.id, par: 4500, min: 3000 },
  });
  await db.rateBoard.create({
    data: {
      companyId,
      key: 'GOLD24',
      date: new Date().toISOString().slice(0, 10),
      rate: 7350_00n,
      unit: 'g',
    },
  });
  // Items seeded straight into the table by earlier phases: their stock is the main store's.
  await db.$executeRaw`
    INSERT INTO "stock_balances" ("id", "company_id", "item_id", "location_id", "batch_id", "qty", "qty2", "value")
    SELECT 'sb' || substr(md5(random()::text || i."id"), 1, 22), i."company_id", i."id", '', '', i."stock", 0,
           round(i."stock" * i."rate")::bigint
    FROM "items" i
    WHERE i."company_id" = ${companyId} AND i."stock" <> 0
      AND NOT EXISTS (SELECT 1 FROM "stock_balances" b WHERE b."item_id" = i."id")`;
  return true;
}
