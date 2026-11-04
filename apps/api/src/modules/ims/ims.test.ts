import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, weekdayOf, zonedToUtc } from '@mono/shared';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';
import { deadStockAlert, openCycle } from './audit';
import { fmsStockMoves } from './fms';
import { proposeReviews } from './review';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const TZ = 'Asia/Kolkata';
const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const today = () => localDate(new Date(), TZ);

/** Owner, a store keeper (member) and a purchase person, with two items. */
async function store() {
  const o = await ownerClient(ctx.app);
  const make = async (name: string) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
    const api = await signedIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: `${name.split(' ')[0]}12345`,
    });
    return { id: r.person.id as string, api };
  };
  const gopal = await make('Gopal Prajapat');
  const amit = await make('Amit Khandelwal');
  const ownerId = (
    await ctx.prisma.user.findFirstOrThrow({ where: { companyId: o.company.id, role: { key: 'OWNER' } } })
  ).id;
  const bearing = (
    await o.api.post('/api/ims/items', {
      code: 'SP-6205',
      name: 'Bearing 6205',
      unit: 'pcs',
      leadTimeDays: 10,
      safetyFactor: 1.5,
      maxQty: 30,
      ratePaise: 25_000,
      vendor: 'SKF Jaipur',
      openingQty: 24,
    })
  ).body as { id: string };
  const resin = (
    await o.api.post('/api/ims/items', {
      code: 'RM-002',
      name: 'Polyester resin',
      unit: 'kg',
      maxQty: 500,
      ratePaise: 18_000,
      openingQty: 400,
    })
  ).body as { id: string };
  return { ...o, companyId: o.company.id, ownerId, gopal, amit, bearing, resin };
}

describe('items and stock moves', () => {
  it('opening stock is a stock in; codes are unique; an import is all or nothing with every problem named', async () => {
    const s = await store();
    const items = (await s.api.get('/api/ims/items')).body;
    expect(items.items.find((i: { code: string }) => i.code === 'SP-6205')).toMatchObject({
      stock: 24,
      band: 'green',
      valuePaise: '600000',
    });
    expect((await s.api.post('/api/ims/items', { code: 'sp-6205', name: 'Copy' })).status).toBe(409);
    const bad = await s.api.post('/api/ims/items/import', {
      table: [
        ['Code', 'Name', 'Opening stock'],
        ['RM-010', 'Quartz grit', '1,000'],
        ['SP-6205', 'Again', '2'],
        ['RM-011', 'X', 'lots'],
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.lines).toEqual([
      { line: 3, errors: ['This code is already in the item master'] },
      { line: 4, errors: ['Name is missing', 'Opening stock must be a number'] },
    ]);
    expect(await ctx.prisma.item.count({ where: { companyId: s.companyId, code: 'RM-010' } })).toBe(0);
    const ok = await s.api.post('/api/ims/items/import', {
      table: [
        ['Code', 'Name', 'Unit', 'Opening stock'],
        ['RM-010', 'Quartz grit', 'kg', '1,000'],
      ],
    });
    expect(ok.body).toEqual({ created: 1, opening: 1 });
    // A member can enter moves but not change the item master.
    expect((await s.gopal.api.post('/api/ims/items', { code: 'X-1', name: 'Nope' })).status).toBe(403);
  });

  it('stock never goes below zero; going red tells purchase', async () => {
    const s = await store();
    await s.api.put('/api/ims/rules', { people: { purchaseIds: [s.amit.id], storeKeeperIds: [s.gopal.id] } });
    const over = await s.gopal.api.post('/api/ims/moves', { itemId: s.bearing.id, type: 'OUT', qty: 25 });
    expect(over.status).toBe(409);
    expect(over.body.error.message).toBe('Only 24 pcs of Bearing 6205 in stock');
    // 24 → 8 of MAX 30: red.
    const out = await s.gopal.api.post('/api/ims/moves', {
      itemId: s.bearing.id,
      type: 'OUT',
      qty: 16,
      note: 'Press 2',
    });
    expect(out.body).toMatchObject({ stock: 8, band: 'red', pending: false });
    const ev = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { companyId: s.companyId, name: 'ims.below_min' },
    });
    expect(ev.payload).toMatchObject({
      item: 'Bearing 6205',
      stock: '8 pcs',
      qty: '22 pcs',
      purchaseIds: [s.amit.id],
    });
    // A move in the future is refused; a transfer moves the location only.
    expect(
      (
        await s.gopal.api.post('/api/ims/moves', {
          itemId: s.bearing.id,
          type: 'IN',
          qty: 1,
          at: new Date(Date.now() + 86_400_000).toISOString(),
        })
      ).status,
    ).toBe(400);
    const moved = await s.gopal.api.post('/api/ims/moves', {
      itemId: s.bearing.id,
      type: 'TRANSFER',
      qty: 8,
      toLocation: 'Rack B2',
    });
    expect(moved.body).toMatchObject({ stock: 8 });
    expect((await ctx.prisma.item.findUniqueOrThrow({ where: { id: s.bearing.id } })).location).toBe(
      'Rack B2',
    );
    const sheet = (await s.api.get(`/api/ims/moves?itemId=${s.bearing.id}`)).body as {
      type: string;
      qty: number;
      balance: number;
    }[];
    expect(sheet.map((m) => [m.type, m.qty, m.balance])).toEqual([
      ['TRANSFER', 0, 8],
      ['OUT', -16, 8],
      ['IN', 24, 24],
    ]);
  });

  it('adjustments wait for an approver: never their own, the owner always can', async () => {
    const s = await store();
    await s.api.put('/api/ims/rules', { people: { approverIds: [s.amit.id] } });
    const adj = await s.gopal.api.post('/api/ims/moves', {
      itemId: s.resin.id,
      type: 'ADJUST',
      qty: -20,
      reason: 'DAMAGED',
      note: 'Drum leaked',
    });
    expect(adj.body.pending).toBe(true);
    expect(Number((await ctx.prisma.item.findUniqueOrThrow({ where: { id: s.resin.id } })).stock)).toBe(400);
    expect(
      await ctx.prisma.domainEvent.count({
        where: { companyId: s.companyId, name: 'ims.adjustment_approval' },
      }),
    ).toBe(1);
    // Not an approver: refused. (Gopal isn't listed.)
    expect(
      (await s.gopal.api.post(`/api/ims/moves/${adj.body.move.id}/decide`, { approve: true })).status,
    ).toBe(403);
    // Amit's own adjustment he can't approve.
    const own = await s.amit.api.post('/api/ims/moves', {
      itemId: s.resin.id,
      type: 'ADJUST',
      qty: 5,
      reason: 'FOUND',
    });
    expect(
      (await s.amit.api.post(`/api/ims/moves/${own.body.move.id}/decide`, { approve: true })).status,
    ).toBe(409);
    // Amit approves Gopal's; the owner (not listed) approves Amit's.
    expect(
      (await s.amit.api.post(`/api/ims/moves/${adj.body.move.id}/decide`, { approve: true })).body.status,
    ).toBe('APPLIED');
    expect(
      (await s.api.post(`/api/ims/moves/${own.body.move.id}/decide`, { approve: true })).body.status,
    ).toBe('APPLIED');
    expect(Number((await ctx.prisma.item.findUniqueOrThrow({ where: { id: s.resin.id } })).stock)).toBe(385);
    // Decided once only.
    expect((await s.api.post(`/api/ims/moves/${adj.body.move.id}/decide`, { approve: false })).status).toBe(
      409,
    );
  });
});

describe('MAX review from history', () => {
  it('proposes from 120 days of use and the red days, and the reviewer applies it', async () => {
    const s = await store();
    const t = today();
    // 2 a day for 120 days (issues dated in the past) and 3 red days in the last 15.
    await ctx.prisma.item.update({
      where: { id: s.bearing.id },
      data: { createdAt: new Date(Date.now() - 200 * 86_400_000) },
    });
    await ctx.prisma.stockMove.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        companyId: s.companyId,
        itemId: s.bearing.id,
        type: 'OUT',
        qty: -2,
        status: 'APPLIED',
        at: zonedToUtc(addDays(t, -120 + i), 11 * 60, TZ),
      })),
    });
    await ctx.prisma.stockSnapshot.createMany({
      data: Array.from({ length: 14 }, (_, i) => ({
        companyId: s.companyId,
        itemId: s.bearing.id,
        date: addDays(t, -14 + i),
        qty: 20,
        band: i < 3 ? 'red' : 'green',
      })),
    });
    expect(await proposeReviews(ctx.prisma, s.companyId)).toBe(1);
    // The resin has no use in the window: it keeps its MAX.
    const list = (await s.api.get('/api/ims/reviews')).body;
    expect(list.due).toHaveLength(1);
    // 2/day × 10 days × (1.5 + 0.25) = 35.
    expect(list.due[0]).toMatchObject({
      change: 'raised',
      redDays: 3,
      avgDailyUse: 2,
      safetyBefore: 1.5,
      safetyAfter: 1.75,
      maxBefore: 30,
      maxAfter: 35,
    });
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: s.companyId, name: 'ims.max_review_due' } }),
    ).toBe(1);
    // Not again while one is waiting.
    expect(await proposeReviews(ctx.prisma, s.companyId)).toBe(0);
    // A member can't apply; the owner sets their own factor instead: 2/day × 10 × 2 = 40.
    expect((await s.gopal.api.post('/api/ims/reviews/apply', { ids: [list.due[0].id] })).status).toBe(403);
    await s.api.post('/api/ims/reviews/apply', { ids: [list.due[0].id], safetyFactor: 2 });
    const item = await ctx.prisma.item.findUniqueOrThrow({ where: { id: s.bearing.id } });
    expect([Number(item.safetyFactor), Number(item.maxQty)]).toEqual([2, 40]);
    expect(item.lastReviewAt).not.toBeNull();
    // Reviewed: nothing due until the next period.
    expect(await proposeReviews(ctx.prisma, s.companyId)).toBe(0);
  });
});

describe('OWS and purchase orders', () => {
  it('a red item is on the order list on its order day; ordering it, receiving in parts, closing', async () => {
    const s = await store();
    // Today is the order day.
    await s.api.put('/api/ims/rules', { ows: { orderWeekday: weekdayOf(today()), daysAhead: 0 } });
    await s.api.post('/api/ims/moves', { itemId: s.bearing.id, type: 'OUT', qty: 19 });
    const ows = (await s.api.get('/api/ims/ows')).body;
    expect(ows).toMatchObject({ open: true, orderDay: today() });
    expect(ows.lines).toHaveLength(1);
    expect(ows.lines[0]).toMatchObject({
      item: { code: 'SP-6205' },
      stock: 5,
      band: 'red',
      qty: 25,
      valuePaise: '625000',
    });
    // Another day of the week: the list isn't open.
    await s.api.put('/api/ims/rules', { ows: { orderWeekday: (weekdayOf(today()) % 7) + 1, daysAhead: 0 } });
    expect((await s.api.get('/api/ims/ows')).body.open).toBe(false);

    const made = (await s.amit.api.post('/api/ims/ows/order', { lines: [{ itemId: s.bearing.id, qty: 25 }] }))
      .body;
    expect(made.orders).toEqual([
      expect.objectContaining({
        vendor: 'SKF Jaipur',
        number: expect.stringMatching(/^PO\/\d{2}-\d{2}\/0001$/),
      }),
    ]);
    // On order now: not short any more.
    expect((await s.api.get('/api/ims/ows')).body.lines).toHaveLength(0);
    const id = made.orders[0].id;
    expect((await s.api.post(`/api/ims/po/${id}/receive`, { lines: [] })).status).toBe(400);
    await s.api.post(`/api/ims/po/${id}/send`, {});
    const po = (await s.api.get(`/api/ims/po/${id}`)).body;
    const line = po.lines[0].id;
    expect(
      (await s.gopal.api.post(`/api/ims/po/${id}/receive`, { lines: [{ lineId: line, qty: 30 }] })).status,
    ).toBe(409);
    expect(
      (await s.gopal.api.post(`/api/ims/po/${id}/receive`, { lines: [{ lineId: line, qty: 10 }] })).body
        .status,
    ).toBe('PARTLY_RECEIVED');
    expect(Number((await ctx.prisma.item.findUniqueOrThrow({ where: { id: s.bearing.id } })).stock)).toBe(15);
    expect((await s.api.post(`/api/ims/po/${id}/cancel`, {})).status).toBe(409);
    expect(
      (await s.gopal.api.post(`/api/ims/po/${id}/receive`, { lines: [{ lineId: line, qty: 15 }] })).body
        .status,
    ).toBe('RECEIVED');
    const ins = await ctx.prisma.stockMove.findMany({
      where: { itemId: s.bearing.id, refType: 'purchase_order' },
    });
    expect(ins.map((m) => Number(m.qty)).sort()).toEqual([10, 15]);
  });
});

describe('audit, dead stock, FMS', () => {
  it('the top items by value are counted each cycle; a difference waits for approval', async () => {
    const s = await store();
    await s.api.put('/api/ims/rules', { audit: { topByValue: 1 } });
    const c = await openCycle(ctx.prisma, s.companyId);
    expect(c.opened).toBe(1);
    expect((await openCycle(ctx.prisma, s.companyId)).opened).toBe(0);
    const list = (await s.api.get('/api/ims/audit')).body;
    // Resin 400 kg × ₹180 is worth more than 24 bearings.
    expect(list.counts.map((x: { item: { code: string } }) => x.item.code)).toEqual(['RM-002']);
    const r = (await s.api.post(`/api/ims/audit/${list.counts[0].id}`, { countedQty: 396 })).body;
    expect(r).toMatchObject({ status: 'COUNTED', difference: -4 });
    expect((await ctx.prisma.stockMove.findUniqueOrThrow({ where: { id: r.adjustmentId } })).status).toBe(
      'PENDING',
    );
    expect((await s.api.post(`/api/ims/audit/${list.counts[0].id}`, { countedQty: 1 })).status).toBe(409);
  });

  it('stock that has not moved for a year is dead; the owner hears once a month', async () => {
    const s = await store();
    await ctx.prisma.item.update({
      where: { id: s.resin.id },
      data: { lastMovedAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    const dead = (await s.api.get('/api/ims/dead')).body;
    expect(dead.items.map((i: { code: string }) => i.code)).toEqual(['RM-002']);
    expect(dead.valuePaise).toBe('7200000');
    expect(await deadStockAlert(ctx.prisma, s.companyId)).toBe(true);
    expect(await deadStockAlert(ctx.prisma, s.companyId)).toBe(false);
  });

  it('an FMS stock step issues the record’s item lines; unknown items and shortages are noted, not fatal', async () => {
    const s = await store();
    const note = await ctx.prisma.$transaction((tx) =>
      fmsStockMoves(
        tx,
        { id: 'rec1', companyId: s.companyId, title: 'Order Shree Tiles', number: 7 },
        {
          key: 'issue',
          name: 'Issue material',
          type: 'AUTO',
          auto: { action: 'stock', direction: 'OUT' },
        } as never,
        {
          startFields: [{ key: 'lines', label: 'Items', type: 'items' }],
          steps: [],
          timeModel: 'shifts',
        } as never,
        {
          lines: [
            { item: 'rm-002', qty: '50' },
            { item: 'Bearing 6205', qty: '99' },
            { item: 'Glue', qty: '1' },
          ],
        },
      ),
    );
    expect(note).toBe(
      'Stock out: 1 line(s) · Only 24 pcs of Bearing 6205 in stock · Glue: not in the item master',
    );
    expect(Number((await ctx.prisma.item.findUniqueOrThrow({ where: { id: s.resin.id } })).stock)).toBe(350);
  });

  it('rules: only admins change them, and only real people can be named', async () => {
    const s = await store();
    expect((await s.gopal.api.put('/api/ims/rules', { max: { useDays: 90 } })).status).toBe(403);
    expect((await s.api.put('/api/ims/rules', { people: { reviewerIds: ['nobody'] } })).status).toBe(400);
    const saved = (await s.api.put('/api/ims/rules', { max: { useDays: 90 } })).body;
    expect(saved.rules.max).toMatchObject({ useDays: 90, reviewEveryDays: 15 });
    void s.ownerId;
  });
});
