import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { at, entry, item, kitchens, loc, ok, storeKeepers, today, total } from './stock-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Api = Awaited<ReturnType<typeof world>>['api'];
type Transfer = {
  id: string;
  number: string;
  kind: string;
  status: string;
  inTransit: boolean;
  from: { name: string };
  paper: { type: string; total: number; number: string } | null;
  purchaseBill: { type: string; total: number } | null;
  lines: {
    itemId: string;
    approved: number;
    dispatched: number;
    received: number;
    short: number;
    damaged: number;
    excess: number;
    rate: number;
    onTheRoad: number;
    substitute: { name: string } | null;
  }[];
};
const transfers = (api: Api) => ok<Transfer[]>(api.get('/api/ims/transfers'));
const one = async (api: Api, id: string) => (await transfers(api)).find((t) => t.id === id)!;
const ask = (api: Api, body: object) =>
  ok<{ id: string; status: string }>(api.post('/api/ims/transfers', body));
const act = (api: Api, id: string, action: string, body: object = {}) =>
  api.post(`/api/ims/transfers/${id}/${action}`, body);

describe('inventory v2: indents, transit, emergencies, papers between entities (phase 13)', () => {
  it('I9, I10, I13, I15: an indent is approved in part or with a substitute, dispatched, in transit, received with differences', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    await storeKeepers(ctx.prisma, w);
    const chef = await k.g.at('Chef Kitchen', k.g.b.kitchen.id, 'HOD');
    const farah = await k.g.at('Farah Rooftop', k.g.b.rooftop.id, 'HOD');
    const paneer = await item(w, { code: 'PAN', name: 'Paneer', unit: 'g', category: 'Dairy' });
    const tomato = await item(w, { code: 'TOM', name: 'Tomato', unit: 'g', category: 'Veg' });
    const cherry = await item(w, { code: 'CHT', name: 'Cherry tomato', unit: 'g', category: 'Veg' });
    const bread = await item(w, { code: 'BRD', name: 'Bread loaf', category: 'Bakery' });
    await entry(w.api, { itemId: paneer, type: 'IN', qty: 5000, ratePaise: 40, locationId: k.store });
    await entry(w.api, { itemId: tomato, type: 'IN', qty: 300, ratePaise: 3, locationId: k.store });
    await entry(w.api, { itemId: cherry, type: 'IN', qty: 1000, ratePaise: 5, locationId: k.store });
    await entry(w.api, { itemId: bread, type: 'IN', qty: 20, ratePaise: 30_00, locationId: k.hot });
    // I15: the outlet's default supplier, and another kitchen for one category; I13: at cost + 10 %.
    await ok(
      w.api.put('/api/ims/routes', {
        toBranchId: k.g.b.rooftop.id,
        fromLocationId: k.store,
        priceRule: 'COST_PLUS',
        percent: 10,
      }),
    );
    await ok(
      w.api.put('/api/ims/routes', {
        toBranchId: k.g.b.rooftop.id,
        category: 'Bakery',
        fromLocationId: k.hot,
      }),
    );
    expect(
      (await farah.api.put('/api/ims/routes', { toBranchId: k.g.b.rooftop.id, fromLocationId: k.hot }))
        .status,
    ).toBe(403);

    const indent = await ask(farah.api, {
      toLocationId: k.pantry,
      lines: [
        { itemId: paneer, qty: 2000 },
        { itemId: tomato, qty: 1000 },
      ],
    });
    expect(indent.status).toBe('REQUESTED');
    expect((await one(farah.api, indent.id)).from.name).toBe('Central store');
    const loaves = await ask(farah.api, { toLocationId: k.pantry, lines: [{ itemId: bread, qty: 4 }] });
    expect((await one(farah.api, loaves.id)).from.name).toBe('Hot kitchen');
    // A request can go to any kitchen or store by naming it; with no route and no name it is refused.
    const lakeAsk = await w.api.post('/api/ims/transfers', {
      toLocationId: k.lake,
      lines: [{ itemId: paneer, qty: 1 }],
    });
    expect(lakeAsk.status).toBe(400);
    expect(
      (
        await ask(w.api, {
          toLocationId: k.lake,
          fromLocationId: k.store,
          lines: [{ itemId: paneer, qty: 1 }],
        })
      ).status,
    ).toBe('REQUESTED');

    // The asker can't approve their own request or dispatch it: that is the supplying side's.
    expect((await act(farah.api, indent.id, 'approve')).status).not.toBe(200);
    // I9: approved in part, and a substitute for what the store is short of.
    await ok(
      act(chef.api, indent.id, 'approve', {
        lines: [
          { itemId: paneer, approved: 1500 },
          { itemId: tomato, approved: 1000, substituteItemId: cherry },
        ],
      }),
    );
    expect((await act(farah.api, indent.id, 'dispatch')).status).not.toBe(200);
    await ok(act(chef.api, indent.id, 'dispatch'));
    // I10: the goods have left the store and are on the road — both sides see it.
    expect([
      await at(ctx.prisma, paneer, k.store),
      await at(ctx.prisma, paneer, '~transit'),
      await at(ctx.prisma, cherry, k.store),
      await total(ctx.prisma, paneer),
    ]).toEqual([3500, 1500, 0, 5000]);
    for (const api of [chef.api, farah.api]) {
      const t = await one(api, indent.id);
      expect([t.status, t.inTransit, t.lines.map((l) => l.onTheRoad), t.lines[1]!.substitute?.name]).toEqual([
        'DISPATCHED',
        true,
        [1500, 1000],
        'Cherry tomato',
      ]);
    }
    // Between two branches of one GSTIN a delivery challan travels with the goods, priced at cost + 10 %.
    const sent = await one(chef.api, indent.id);
    expect(sent.paper).toMatchObject({ type: 'CHALLAN', total: 1500 * 44 + 1000 * 6 });
    expect(sent.lines[0]!.rate).toBe(44);

    // Received: 1 400 good, 50 damaged, so 50 short; the substitute in full. The differences wait.
    expect((await act(chef.api, indent.id, 'receive')).status).not.toBe(200);
    const got = await ok<{ status: string; differences: boolean }>(
      act(farah.api, indent.id, 'receive', {
        lines: [
          { itemId: paneer, received: 1400, damaged: 50 },
          { itemId: tomato, received: 1000 },
        ],
      }),
    );
    expect(got).toMatchObject({ status: 'RECEIVED', differences: true });
    expect([
      await at(ctx.prisma, paneer, k.pantry),
      await at(ctx.prisma, cherry, k.pantry),
      await at(ctx.prisma, paneer, '~transit'),
    ]).toEqual([1400, 1000, 100]);
    const waiting = await one(farah.api, indent.id);
    expect([waiting.lines[0]!.short, waiting.lines[0]!.damaged, waiting.lines[0]!.onTheRoad]).toEqual([
      50, 50, 100,
    ]);
    // Whoever received it does not decide its differences; a stock approver writes them off.
    expect((await act(farah.api, indent.id, 'settle')).status).toBe(403);
    await ok(act(w.api, indent.id, 'settle', { note: 'Crate fell in the van' }));
    expect([
      (await one(w.api, indent.id)).status,
      await at(ctx.prisma, paneer, '~transit'),
      await total(ctx.prisma, paneer),
    ]).toEqual(['CLOSED', 0, 4900]);

    // More arrives than was dispatched: the extra is taken in once it is approved.
    const more = await ask(farah.api, { toLocationId: k.pantry, lines: [{ itemId: paneer, qty: 500 }] });
    await ok(act(chef.api, more.id, 'approve'));
    await ok(act(chef.api, more.id, 'dispatch'));
    await ok(act(farah.api, more.id, 'receive', { lines: [{ itemId: paneer, received: 520 }] }));
    expect((await one(w.api, more.id)).lines[0]!.excess).toBe(20);
    await ok(act(w.api, more.id, 'settle'));
    expect([await at(ctx.prisma, paneer, k.pantry), await total(ctx.prisma, paneer)]).toEqual([1920, 4920]);
    // Nothing more than was asked, and a rejected request moves nothing.
    expect(
      (await act(chef.api, loaves.id, 'approve', { lines: [{ itemId: bread, approved: 9 }] })).status,
    ).toBe(400);
    await ok(act(chef.api, loaves.id, 'reject', { note: 'Oven is down' }));
    expect([(await one(farah.api, loaves.id)).status, await at(ctx.prisma, bread, k.hot)]).toEqual([
      'REJECTED',
      20,
    ]);
  });

  it('I11: an emergency outlet-to-outlet transfer needs a yes from both sides (or one, by the rule) and is flagged', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    await storeKeepers(ctx.prisma, w);
    const farah = await k.g.at('Farah Rooftop', k.g.b.rooftop.id, 'HOD');
    const leela = await k.g.at('Leela Lake', k.g.b.lake.id, 'HOD');
    const ice = await item(w, { code: 'ICE', name: 'Ice', unit: 'kg' });
    await entry(w.api, { itemId: ice, type: 'IN', qty: 100, ratePaise: 10_00, locationId: k.pantry });
    const body = {
      kind: 'EMERGENCY',
      fromLocationId: k.pantry,
      toLocationId: k.lake,
      lines: [{ itemId: ice, qty: 30 }],
    };
    expect((await leela.api.post('/api/ims/transfers', body)).status).toBe(400);
    const sos = await ask(leela.api, { ...body, reason: 'Ice machine broke before a banquet' });
    // The asking outlet's manager says yes: still waiting for the supplying outlet.
    expect((await ok<{ status: string }>(act(leela.api, sos.id, 'approve'))).status).toBe('REQUESTED');
    expect((await act(leela.api, sos.id, 'dispatch')).status).not.toBe(200);
    expect((await ok<{ status: string }>(act(farah.api, sos.id, 'approve'))).status).toBe('APPROVED');
    await ok(act(farah.api, sos.id, 'dispatch'));
    expect((await ok<{ status: string }>(act(leela.api, sos.id, 'receive'))).status).toBe('CLOSED');
    expect([await at(ctx.prisma, ice, k.pantry), await at(ctx.prisma, ice, k.lake)]).toEqual([70, 30]);
    expect((await one(w.api, sos.id)).kind).toBe('EMERGENCY');
    // By the rule, one yes is enough.
    await ok(w.api.put('/api/ims/rules', { stock: { emergencyApprovals: 'one' } }));
    const again = await ask(leela.api, { ...body, reason: 'Still broken' });
    expect((await ok<{ status: string }>(act(farah.api, again.id, 'approve'))).status).toBe('APPROVED');
  });

  it('I14: between two GSTINs a tax invoice goes with the goods and the receiver books a purchase; a store transfers on its own', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    const gujarat = await ok<{ id: string }>(
      w.api.post('/api/branches/entities', {
        name: 'GGM Hotels Gujarat',
        state: 'Gujarat',
        taxId: '24AAAAA0000A1Z5',
      }),
    );
    const surat = await ok<{ id: string }>(
      w.api.post('/api/org/branches', { name: 'Surat Outlet', type: 'OUTLET', entityId: gujarat.id }),
    );
    const suratStore = await loc(w, surat.id, 'Surat store');
    await ok(
      w.api.put('/api/money/tax-rates', { code: 'GST5', name: 'GST 5%', percent: 5, from: '2020-01-01' }),
    );
    const paneer = await item(
      w,
      { code: 'PAN', name: 'Paneer', unit: 'kg' },
      { taxCode: 'GST5', hsn: '0406' },
    );
    await entry(w.api, { itemId: paneer, type: 'IN', qty: 50, ratePaise: 400_00, locationId: k.store });
    // A store's own transfer (DIRECT) needs nobody's yes.
    const t = await ask(w.api, {
      kind: 'DIRECT',
      fromLocationId: k.store,
      toLocationId: suratStore,
      lines: [{ itemId: paneer, qty: 10 }],
    });
    expect(t.status).toBe('APPROVED');
    await ok(act(w.api, t.id, 'dispatch'));
    const sent = await one(w.api, t.id);
    // Rajasthan → Gujarat: IGST 5 % on 10 kg at cost.
    expect(sent.paper).toMatchObject({ type: 'INVOICE', total: 10 * 400_00 * 1.05 });
    const invoice = await ctx.prisma.bill.findFirstOrThrow({
      where: { companyId: w.companyId, sourceType: 'stock_transfer', sourceId: t.id },
    });
    expect((invoice.taxes as { name: string }[]).map((x) => x.name)).toEqual(['IGST']);
    await ok(act(w.api, t.id, 'receive'));
    const done = await one(w.api, t.id);
    expect([done.status, done.purchaseBill]).toEqual([
      'CLOSED',
      {
        id: expect.any(String),
        number: expect.any(String),
        type: 'PURCHASE_BILL',
        total: 10 * 400_00 * 1.05,
      },
    ]);
    // Each paper is in its own entity's books.
    const purchase = await ctx.prisma.bill.findFirstOrThrow({
      where: { companyId: w.companyId, sourceType: 'stock_transfer_in', sourceId: t.id },
    });
    expect([invoice.entityId === purchase.entityId, purchase.entityId]).toEqual([false, gujarat.id]);
    expect([await at(ctx.prisma, paneer, suratStore), await at(ctx.prisma, paneer, k.store)]).toEqual([
      10, 40,
    ]);
    // Inside one branch (store → kitchen) no paper is raised.
    const inside = await ask(w.api, {
      kind: 'DIRECT',
      fromLocationId: k.store,
      toLocationId: k.hot,
      lines: [{ itemId: paneer, qty: 5 }],
    });
    await ok(act(w.api, inside.id, 'dispatch'));
    expect((await one(w.api, inside.id)).paper).toBeNull();
    void today;
  });
});
