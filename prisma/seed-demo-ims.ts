import type { Db } from '@mono/db';
import { actorFor, openCycle, proposeReviews, recordCount } from '@mono/api/services';
import { addDays, bandOf, localDate, zonedToUtc, type Band } from '@mono/shared';

/** [code, name, unit, category, daily use, lead days, ₹ rate, vendor, where it ends (share of MAX)] */
type Spec = [string, string, string, string, number, number, number, string, number];

// GGM-style quartz slab plant. The last number sets where today's stock sits against MAX (red < ⅓, purple > 1).
const SPECS: Spec[] = [
  ['RM-001', 'Quartz grit 0.1–0.3 mm', 'kg', 'Raw material', 900, 10, 9, 'Shree Minerals Ajmer', 0.82],
  ['RM-002', 'Quartz grit 0.3–0.7 mm', 'kg', 'Raw material', 1100, 10, 9, 'Shree Minerals Ajmer', 0.25],
  ['RM-003', 'Quartz grit 0.7–1.2 mm', 'kg', 'Raw material', 600, 10, 10, 'Shree Minerals Ajmer', 0.55],
  ['RM-004', 'Quartz powder 400 mesh', 'kg', 'Raw material', 700, 7, 8, 'Rajasthan Silica', 0.9],
  ['RM-005', 'Unsaturated polyester resin', 'kg', 'Raw material', 260, 14, 185, 'Polyrocks Vadodara', 0.7],
  ['RM-006', 'MEKP hardener', 'kg', 'Raw material', 4, 14, 420, 'Polyrocks Vadodara', 0.2],
  ['RM-007', 'Cobalt accelerator', 'kg', 'Raw material', 2, 14, 650, 'Polyrocks Vadodara', 0.6],
  ['RM-008', 'Silane coupling agent', 'kg', 'Raw material', 3, 21, 1150, 'Chemtrade Mumbai', 1.35],
  ['RM-009', 'Pigment white (TiO2)', 'kg', 'Raw material', 18, 14, 320, 'Colorchem Ahmedabad', 0.75],
  ['RM-010', 'Pigment black', 'kg', 'Raw material', 6, 14, 280, 'Colorchem Ahmedabad', 0.45],
  ['RM-011', 'Pigment grey', 'kg', 'Raw material', 5, 14, 300, 'Colorchem Ahmedabad', 0.9],
  ['RM-012', 'Mirror flakes', 'kg', 'Raw material', 3, 21, 900, 'Glitter India', 1.6],
  ['RM-013', 'Glass granules (Calacatta)', 'kg', 'Raw material', 40, 21, 60, 'Shree Minerals Ajmer', 0.85],
  ['CN-001', 'Diamond calibrating roller', 'pcs', 'Consumable', 0.3, 30, 14500, 'Tyrolit India', 0.65],
  ['CN-002', 'Polishing pad grit 60', 'pcs', 'Consumable', 6, 10, 380, 'Abrasives Morbi', 0.3],
  ['CN-003', 'Polishing pad grit 120', 'pcs', 'Consumable', 6, 10, 380, 'Abrasives Morbi', 0.7],
  ['CN-004', 'Polishing pad grit 220', 'pcs', 'Consumable', 5, 10, 400, 'Abrasives Morbi', 0.8],
  ['CN-005', 'Polishing pad grit 400', 'pcs', 'Consumable', 5, 10, 420, 'Abrasives Morbi', 0.6],
  ['CN-006', 'Polishing pad grit 800', 'pcs', 'Consumable', 4, 10, 450, 'Abrasives Morbi', 1.2],
  ['CN-007', 'Polishing pad grit 1500 (lux)', 'pcs', 'Consumable', 3, 10, 520, 'Abrasives Morbi', 0.9],
  ['CN-008', 'Diamond cutting blade 400 mm', 'pcs', 'Consumable', 0.5, 21, 9200, 'Tyrolit India', 0.4],
  ['CN-009', 'Release film roll', 'roll', 'Consumable', 2, 14, 2400, 'Packwell Jaipur', 0.75],
  ['CN-010', 'Mould release wax', 'kg', 'Consumable', 1.5, 14, 640, 'Chemtrade Mumbai', 0.85],
  ['CN-011', 'Cotton waste', 'kg', 'Consumable', 8, 5, 55, 'Local market', 0.7],
  ['CN-012', 'Acetone', 'ltr', 'Consumable', 6, 7, 110, 'Chemtrade Mumbai', 0.15],
  ['SP-001', 'Bearing 6205 ZZ', 'pcs', 'Spare part', 0.4, 10, 250, 'SKF Jaipur', 0.9],
  ['SP-002', 'Bearing 6310 2RS', 'pcs', 'Spare part', 0.2, 14, 1350, 'SKF Jaipur', 0.6],
  ['SP-003', 'V-belt B-72', 'pcs', 'Spare part', 0.3, 7, 420, 'Fenner Jaipur', 0.8],
  ['SP-004', 'Hydraulic oil 68', 'ltr', 'Spare part', 3, 7, 160, 'Servo Ajmer', 0.55],
  ['SP-005', 'Gear oil EP 220', 'ltr', 'Spare part', 1, 7, 210, 'Servo Ajmer', 1.4],
  ['SP-006', 'Vacuum pump seal kit', 'set', 'Spare part', 0.1, 30, 7800, 'Breton Service', 0.7],
  ['SP-007', 'Proximity sensor M18', 'pcs', 'Spare part', 0.1, 14, 1850, 'Electro Controls', 0.25],
  ['SP-008', 'Contactor 32A', 'pcs', 'Spare part', 0.1, 10, 1600, 'Electro Controls', 0.9],
  ['SP-009', 'Grease EP2', 'kg', 'Spare part', 0.8, 7, 240, 'Servo Ajmer', 0.85],
  ['SP-010', 'Pneumatic cylinder seal', 'set', 'Spare part', 0.2, 14, 980, 'Festo Ahmedabad', 0.75],
  ['SP-011', 'Conveyor roller 89 mm', 'pcs', 'Spare part', 0.3, 14, 1100, 'Local fabricator', 0.6],
  ['SP-012', 'Mixer paddle (wear plate)', 'pcs', 'Spare part', 0.1, 30, 5400, 'Breton Service', 0.95],
  ['PK-001', 'Wooden A-frame', 'pcs', 'Packing', 6, 7, 1450, 'Kishangarh Timber', 0.7],
  ['PK-002', 'Stretch film', 'roll', 'Packing', 4, 7, 520, 'Packwell Jaipur', 0.3],
  ['PK-003', 'Edge protector (corner)', 'pcs', 'Packing', 160, 7, 6, 'Packwell Jaipur', 0.85],
  ['PK-004', 'Strapping roll PP', 'roll', 'Packing', 2, 7, 760, 'Packwell Jaipur', 0.65],
  ['PK-005', 'Strapping clips', 'box', 'Packing', 1, 7, 340, 'Packwell Jaipur', 1.3],
  ['PK-006', 'Levanto slab sticker', 'pcs', 'Packing', 160, 14, 2, 'Print Point Ajmer', 0.9],
  ['PK-007', 'Protective film (slab face)', 'roll', 'Packing', 3, 10, 1850, 'Packwell Jaipur', 0.75],
  ['GN-001', 'Safety gloves', 'pair', 'General', 12, 5, 45, 'Safety Store', 0.8],
  ['GN-002', 'Dust mask N95', 'pcs', 'General', 20, 5, 28, 'Safety Store', 0.7],
  ['GN-003', 'Diesel (forklift)', 'ltr', 'General', 35, 3, 92, 'IOCL Kishangarh', 0.6],
  ['GN-004', 'Forklift tyre', 'pcs', 'General', 0.05, 21, 9800, 'Godrej Material', 0.9],
];
/** Old stock nobody uses any more: dead stock. */
const DEAD: [string, string, string, string, number, number, string][] = [
  ['OLD-001', 'Pigment blue (old colour)', 'kg', 'Raw material', 85, 290, 'Colorchem Ahmedabad'],
  ['OLD-002', 'Granite polishing brick', 'pcs', 'Consumable', 40, 650, 'Abrasives Morbi'],
];

type MoveData = Exclude<NonNullable<Parameters<Db['stockMove']['createMany']>[0]>['data'], unknown[]>;

const round = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 1000) / 1000);

/**
 * Phase 8 demo (CLAUDE.md §15: "50 items with stock history"): 50 items, 120 days of issues and receipts, the
 * rules' people, last fortnight's bands (a few red, a few over MAX), MAX reviews due, purchase orders in each
 * state, a damage adjustment to approve, this cycle's audit counts and two dead items. Added once.
 */
export async function seedDemoIms(db: Db, companyId: string): Promise<boolean> {
  if (await db.item.count({ where: { companyId } })) return false;
  const tz = (await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } }))
    .timezone;
  const people = await db.user.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, name: true },
  });
  const id = (name: string) => people.find((p) => p.name === name)?.id;
  const ids = (...names: string[]) => names.map(id).filter((x): x is string => Boolean(x));
  await db.imsRules.create({
    data: {
      companyId,
      rules: {
        people: {
          storeKeeperIds: ids('Gopal Prajapat', 'Sanjay Tak'),
          purchaseIds: ids('Amit Khandelwal'),
          reviewerIds: ids('Ajay Meena'),
          auditIds: ids('Pooja Jain'),
          approverIds: ids('Ajay Meena'),
          anyOne: true,
          neverOwn: true,
          ownerAlways: true,
        },
      },
    },
  });

  const today = localDate(new Date(), tz);
  const gopal = id('Gopal Prajapat') ?? null;
  // A fixed pseudo-random sequence: the same demo every time.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  for (const [i, s] of SPECS.entries()) {
    const [code, name, unit, category, use, lead, rupees, vendor, endShare] = s;
    const max = Math.max(round(use * lead * 1.5), 1);
    const rate = BigInt(Math.round(rupees * 100));
    const created = zonedToUtc(addDays(today, -130), 9 * 60, tz);
    const item = await db.item.create({
      data: {
        companyId,
        code,
        name,
        unit,
        category,
        vendor,
        leadTimeDays: lead,
        safetyFactor: 1.5,
        maxQty: max,
        rate,
        location: `${category.slice(0, 2).toUpperCase()}-${(i % 6) + 1}`,
        createdAt: created,
      },
    });
    // 120 days of issues (a little up and down, none on Sundays) and receipts every lead time.
    const days = Array.from({ length: 120 }, (_, d) => addDays(today, -120 + d));
    const outs = days.map((d) =>
      new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? 0 : round(use * (0.6 + rnd() * 0.8)),
    );
    const ins = days.map((_, d) => (d > 0 && d % lead === 0 ? round(use * lead) : 0));
    const end = round(max * endShare);
    let opening = end + outs.reduce((a, b) => a + b, 0) - ins.reduce((a, b) => a + b, 0);
    // Never below zero on the way.
    let bal = opening;
    let low = Infinity;
    days.forEach((_, d) => ((bal += ins[d]! - outs[d]!), (low = Math.min(low, bal))));
    if (low < 0) opening -= low;
    opening = round(Math.max(opening, 0));
    const moves: MoveData[] = [];
    bal = opening;
    moves.push({
      companyId,
      itemId: item.id,
      type: 'IN',
      qty: opening,
      rate,
      note: 'Opening stock',
      refType: 'import',
      status: 'APPLIED',
      balance: opening,
      at: created,
      createdById: gopal,
    });
    const snaps: { companyId: string; itemId: string; date: string; qty: number; band: Band }[] = [];
    days.forEach((d, k) => {
      if (ins[k]) {
        bal = round(bal + ins[k]!);
        moves.push({
          companyId,
          itemId: item.id,
          type: 'IN',
          qty: ins[k]!,
          rate,
          note: `Received from ${vendor}`,
          status: 'APPLIED',
          balance: bal,
          at: zonedToUtc(d, 10 * 60, tz),
          createdById: gopal,
        });
      }
      if (outs[k]) {
        bal = round(bal - outs[k]!);
        moves.push({
          companyId,
          itemId: item.id,
          type: 'OUT',
          qty: -outs[k]!,
          rate,
          note: k % 3 ? 'Issued to production' : 'Issued to Press 2',
          status: 'APPLIED',
          balance: bal,
          at: zonedToUtc(d, 15 * 60, tz),
          createdById: gopal,
        });
      }
      snaps.push({ companyId, itemId: item.id, date: d, qty: bal, band: bandOf(bal, max) });
    });
    // The last fortnight: red items were red a few days running; over-MAX items mostly over.
    const band = bandOf(end, max);
    if (band === 'red') snaps.slice(-4).forEach((x) => (x.band = 'red'));
    if (band === 'purple') snaps.slice(-9).forEach((x) => (x.band = 'purple'));
    await db.stockMove.createMany({ data: moves });
    await db.stockSnapshot.createMany({ data: snaps, skipDuplicates: true });
    // Most were reviewed a week ago; the red and over-MAX ones (and a few more) are due now.
    const due = band === 'red' || band === 'purple' || i % 9 === 0;
    await db.item.update({
      where: { id: item.id },
      data: {
        stock: end,
        band,
        lastMovedAt: moves[moves.length - 1]!.at as Date,
        lastReviewAt: due ? null : new Date(Date.now() - 7 * 86_400_000),
      },
    });
  }
  for (const [code, name, unit, category, stock, rupees, vendor] of DEAD) {
    const at = new Date(Date.now() - 400 * 86_400_000);
    const item = await db.item.create({
      data: {
        companyId,
        code,
        name,
        unit,
        category,
        vendor,
        stock,
        rate: BigInt(rupees * 100),
        band: 'none',
        createdAt: at,
        lastMovedAt: at,
        lastReviewAt: at,
      },
    });
    await db.stockMove.create({
      data: {
        companyId,
        itemId: item.id,
        type: 'IN',
        qty: stock,
        rate: BigInt(rupees * 100),
        note: 'Opening stock',
        refType: 'import',
        balance: stock,
        at,
        createdById: gopal,
      },
    });
  }

  // Purchase orders: one received last month, one part received, one sent (on order).
  const items = await db.item.findMany({
    where: { companyId },
    select: { id: true, code: true, rate: true, maxQty: true, stock: true },
  });
  const it = (code: string) => items.find((x) => x.code === code)!;
  const amit = id('Amit Khandelwal') ?? null;
  const po = async (
    n: number,
    vendor: string,
    status: string,
    lines: [string, number, number][],
    daysAgo: number,
  ) =>
    db.purchaseOrder.create({
      data: {
        companyId,
        number: `PO/${fyShort(today)}/${String(n).padStart(4, '0')}`,
        vendor,
        status,
        createdById: amit,
        createdAt: new Date(Date.now() - daysAgo * 86_400_000),
        sentAt: status === 'DRAFT' ? null : new Date(Date.now() - (daysAgo - 1) * 86_400_000),
        expectedOn: addDays(today, 10 - daysAgo),
        lines: {
          create: lines.map(([code, qty, got]) => ({
            companyId,
            itemId: it(code).id,
            qty,
            receivedQty: got,
            rate: it(code).rate,
          })),
        },
      },
    });
  await po(1, 'Polyrocks Vadodara', 'RECEIVED', [['RM-005', 3600, 3600]], 30);
  await po(
    2,
    'Abrasives Morbi',
    'PARTLY_RECEIVED',
    [
      ['CN-003', 60, 30],
      ['CN-004', 50, 50],
    ],
    6,
  );
  await po(3, 'Chemtrade Mumbai', 'SENT', [['CN-010', 25, 0]], 2);
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'po', fy: fyShort(today) } },
    create: { companyId, key: 'po', fy: fyShort(today), value: 3 },
    update: { value: 3 },
  });

  // Gopal found two damaged pads; it waits for Ajay.
  await db.stockMove.create({
    data: {
      companyId,
      itemId: it('CN-002').id,
      type: 'ADJUST',
      qty: -2,
      rate: it('CN-002').rate,
      reason: 'DAMAGED',
      note: 'Torn while fitting',
      status: 'PENDING',
      createdById: gopal,
    },
  });
  // This cycle's audit: the top 50 by value; Pooja has counted two.
  await openCycle(db, companyId);
  const pooja = id('Pooja Jain');
  if (pooja) {
    const actor = (await actorFor(db, companyId, pooja))!;
    const counts = await db.auditCount.findMany({ where: { companyId }, include: { item: true }, take: 2 });
    for (const [k, c] of counts.entries())
      await recordCount(db, { ...actor, permissions: [...actor.permissions, 'ims.edit'] }, c.id, {
        countedQty: Number(c.item.stock) - (k === 1 ? 3 : 0),
      });
  }
  await proposeReviews(db, companyId);
  return true;
}

const fyShort = (today: string) => {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
};
