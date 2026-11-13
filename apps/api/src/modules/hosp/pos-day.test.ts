import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { add, bill, ok, open, pay, post, restaurant } from './pos-kit';
import { sendQueued } from './print';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Z = {
  businessDay: string;
  orders: number;
  covers: number;
  open: number;
  bills: number;
  sales: number;
  tax: number;
  serviceCharge: number;
  cash: number | null;
  byMode: { mode: string; kind: string; amount: number | null }[];
  tips: { steward: string; amount: number }[];
  voids: { count: number; value: number };
  closed: { counted: number; report: { difference: number; cash: number } } | null;
  canClose: boolean;
};

describe('POS: shift and day close, printing (phase 15)', () => {
  it('P30–P32: the X report of a shift, the Z report, a blind cash count, a closed day takes nothing more, only the owner reopens', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    // P30: the steward opens a shift with a ₹1,000 float.
    await post(s, `/api/pos/outlets/${r.outlet}/shift/open`, { float: 1000_00 });
    expect((await s.post(`/api/pos/outlets/${r.outlet}/shift/open`, { float: 0 })).status).toBe(409);
    const a = await open(s, r, 'T1', { covers: 3 });
    await add(s, a.id, [{ menuItemId: r.m.tikka, variantKey: 'full' }, { menuItemId: r.m.dal }]);
    const ca = await bill(s, a.id);
    await pay(
      s,
      ca.id,
      [
        { modeId: r.modes.cash, amount: 400_00 },
        { modeId: r.modes.card, amount: 290_00, reference: 'SLIP 77' },
      ],
      { amount: 40_00 },
    );
    const b = await open(r.steward2.api, r, 'T2');
    await add(r.steward2.api, b.id, [{ menuItemId: r.m.cola, qty: 2 }]);
    const cb = await bill(r.steward2.api, b.id);
    // ₹160 + ₹16 + ₹8 = ₹184, in cash, taken by the other steward.
    await pay(r.steward2.api, cb.id, [{ modeId: r.modes.cash, amount: cb.total }]);
    type Shift = {
      open: { float: number } | null;
      x: { cash: number; expectedInDrawer: number; byMode: { mode: string; amount: number }[] };
    };
    const x = await ok<Shift>(s.get(`/api/pos/outlets/${r.outlet}/shift`));
    // Only what this steward took: ₹400 cash and ₹290 by card; the drawer should hold the float + ₹400.
    expect([x.x.cash, x.x.expectedInDrawer, x.x.byMode.map((m) => [m.mode, m.amount])]).toEqual([
      400_00,
      1400_00,
      [
        ['Cash', 400_00],
        ['Card', 290_00],
      ],
    ]);
    expect(
      await post<{ counted: number; difference: number }>(s, `/api/pos/outlets/${r.outlet}/shift/close`, {
        cash: { 500: 2, 100: 4 },
      }),
    ).toMatchObject({ counted: 1400_00, difference: 0 });
    expect((await ok<Shift>(s.get(`/api/pos/outlets/${r.outlet}/shift`))).open).toBeNull();

    // P31: the Z report of the day. With a blind count, whoever closes does not see the cash expected.
    const z = (api: typeof s) => ok<Z>(api.get(`/api/pos/outlets/${r.outlet}/day`));
    const seen = await z(w.api);
    expect(seen).toMatchObject({
      orders: 2,
      covers: 5,
      open: 0,
      bills: 2,
      sales: 690_00 + 184_00,
      tax: 30_00 + 8_00,
      serviceCharge: 60_00 + 16_00,
      cash: 584_00,
      closed: null,
    });
    expect(seen.byMode.map((m) => [m.mode, m.amount])).toEqual([
      ['Cash', 584_00],
      ['Card', 290_00],
    ]);
    expect(seen.tips).toEqual([{ steward: 'Ravi Steward', amount: 40_00 }]);
    const blind = await z(r.manager.api);
    expect([
      blind.cash,
      blind.byMode.find((m) => m.kind === 'CASH')!.amount,
      blind.canClose,
      (await z(s)).canClose,
    ]).toEqual([null, null, true, false]);
    // A running order blocks the close; so does someone who is not a closer.
    const late = await open(s, r, 'T3');
    await add(s, late.id, [{ menuItemId: r.m.naan }]);
    const closing = (api: typeof s, cash: object) =>
      api.post(`/api/pos/outlets/${r.outlet}/day/close`, { cash });
    expect((await closing(s, {})).status).toBe(403);
    expect((await closing(r.manager.api, { 500: 1 })).status).toBe(409);
    const cl = await bill(s, late.id);
    await pay(s, cl.id, [{ modeId: r.modes.cash, amount: cl.total }]);
    // ₹60 + ₹6 + ₹3 = ₹69 more cash: ₹653 expected; ₹650 counted → ₹3 short.
    const done = await ok<{ counted: number; difference: number; cash: number; businessDay: string }>(
      closing(r.manager.api, { 500: 1, 100: 1, 50: 1 }),
    );
    expect(done).toMatchObject({ cash: 653_00, counted: 650_00, difference: -3_00 });
    expect((await z(r.manager.api)).closed).toMatchObject({ counted: 650_00, report: { difference: -3_00 } });
    expect((await closing(r.manager.api, { 500: 1 })).status).toBe(409);

    // P32: the day is closed — no new order, item, bill or payment is dated into it.
    const refused = await s.post('/api/pos/orders', { outletId: r.outlet, tableIds: [r.t.T4] });
    expect([refused.status, refused.body.error.message]).toEqual([409, expect.stringContaining('is closed')]);
    // Reopening is the owner's, with a reason.
    const reopen = (api: typeof s, reason: string) =>
      api.post(`/api/pos/outlets/${r.outlet}/day/reopen`, { businessDay: done.businessDay, reason });
    expect((await reopen(r.manager.api, 'A late table walked in')).status).toBe(403);
    expect((await reopen(w.api, 'x')).status).toBe(400);
    await ok(reopen(w.api, 'A late table walked in'));
    expect((await open(s, r, 'T4')).number).toBe(4);
    expect(
      await ctx.prisma.auditLog.count({ where: { companyId: w.companyId, action: 'pos.day_reopened' } }),
    ).toBe(1);
  });

  it('P35, P36: tickets reach a network printer as ESC/POS; an offline printer fails after retries and the display still has the ticket; a site agent pulls its own', async () => {
    // A thermal printer on the network, as far as the server can tell: it takes bytes on a port.
    const got: Buffer[] = [];
    const printer = net.createServer((socket) => socket.on('data', (d) => got.push(d)));
    await new Promise<void>((resolve) => printer.listen(0, '127.0.0.1', resolve));
    const port = (printer.address() as net.AddressInfo).port;
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w, `127.0.0.1:${port}`);
    const s = r.steward.api;
    const o = await open(s, r, 'T1');
    await add(s, o.id, [{ menuItemId: r.m.cola, qty: 2, note: 'No ice' }]);
    expect(await sendQueued(ctx.prisma, w.companyId)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bytes = Buffer.concat(got);
    expect([
      bytes[0],
      bytes[1],
      bytes.toString('latin1').includes('KOT 1'),
      bytes.toString('latin1').includes('2 x Cola'),
      bytes.toString('latin1').includes('* No ice'),
    ]).toEqual([0x1b, 0x40, true, true, true]);
    expect((await ctx.prisma.printJob.findFirstOrThrow({ where: { companyId: w.companyId } })).status).toBe(
      'SENT',
    );

    // The printer goes offline: the job is tried five times, then FAILED — and the ticket is still on the display.
    await new Promise<void>((resolve) => printer.close(() => resolve()));
    await add(s, o.id, [{ menuItemId: r.m.cola }]);
    for (let i = 0; i < 4; i += 1) expect(await sendQueued(ctx.prisma, w.companyId)).toBe(0);
    type Job = { status: string; tries: number; printer: string; error: string | null };
    expect(await ok<Job[]>(s.get('/api/pos/print-jobs'))).toMatchObject([
      { status: 'QUEUED', tries: 4, printer: 'Bar KOT' },
    ]);
    await sendQueued(ctx.prisma, w.companyId);
    expect((await ok<Job[]>(s.get('/api/pos/print-jobs')))[0]).toMatchObject({ status: 'FAILED', tries: 5 });
    const kds = await ok<{ tickets: { number: number }[] }>(
      s.get(`/api/pos/outlets/${r.outlet}/kds?stationId=${r.stations.bar}`),
    );
    expect(kds.tickets.map((t) => t.number)).toEqual([1, 2]);

    // P36: a printer behind a branch's site agent is not the server's to reach: the agent pulls the job and reports.
    const agentPrinter = await post(w.api, '/api/hosp/printers', {
      name: 'Kitchen (agent)',
      kind: 'KOT',
      connection: 'AGENT',
      branchId: r.g.b.rooftop.id,
    });
    await ok(
      w.api.put(`/api/hosp/stations/${r.stations.kitchen}`, {
        outletId: r.outlet,
        name: 'Kitchen',
        printerId: agentPrinter.id,
      }),
    );
    await add(s, o.id, [{ menuItemId: r.m.dal }]);
    expect(await sendQueued(ctx.prisma, w.companyId)).toBe(0);
    type AgentJob = { id: string; kind: string; printer: string; payload: string };
    const jobs = await ok<AgentJob[]>(s.get(`/api/pos/print-jobs/agent?branchId=${r.g.b.rooftop.id}`));
    expect(jobs.map((j) => [j.kind, j.printer])).toEqual([['KOT', 'Kitchen (agent)']]);
    expect(Buffer.from(jobs[0]!.payload, 'base64').toString('latin1')).toContain('1 x Dal makhani');
    await ok(s.post(`/api/pos/print-jobs/${jobs[0]!.id}/done`, { ok: true }));
    expect(await ok<AgentJob[]>(s.get(`/api/pos/print-jobs/agent?branchId=${r.g.b.rooftop.id}`))).toEqual([]);
    expect((await s.post(`/api/pos/print-jobs/${jobs[0]!.id}/done`, { ok: true })).status).toBe(409);
  });
});
