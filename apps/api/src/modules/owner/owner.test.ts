import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient } from '../../test/helpers';
import { add, bill, ok, open, pay, restaurant } from '../hosp/pos-kit';
import { world } from '../records/testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

describe("the owner's desk", () => {
  it('ranks branches, lists what broke its range, and shows where money leaks', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    // A table that pays with a 5 % discount, and a fired dish voided by the manager.
    const o = await open(s, r, 'T1');
    await add(s, o.id, [
      { menuItemId: r.m.dal, qty: 2 },
      { menuItemId: r.m.naan, qty: 4 },
    ]);
    const c = await bill(s, o.id, { discount: { kind: 'PERCENT', value: 5, reason: 'Regular guest' } });
    await pay(s, c.id, [{ modeId: r.modes.cash, amount: c.total }]);
    const o2 = await open(s, r, 'T2');
    await add(s, o2.id, [{ menuItemId: r.m.dal }, { menuItemId: r.m.kulfi }]);
    const items = (await ok<{ items: { id: string; name: string }[] }>(s.get(`/api/pos/orders/${o2.id}`)))
      .items;
    await ok(
      r.manager.api.post(
        `/api/pos/orders/${o2.id}/items/${items.find((i) => i.name === 'Dal makhani')!.id}/void`,
        {
          reason: 'Guest changed their mind',
          cooked: false,
        },
      ),
    );
    const span = `?from=${today()}&to=${today()}`;
    const league = await ok<{
      branches: {
        branch: string;
        sales: number;
        discountPct: number;
        voidPct: number;
        score: number | null;
      }[];
    }>(w.api.get(`/api/owner/league${span}`));
    const roof = league.branches.find((b) => b.branch === 'Rooftop Jaipur')!;
    expect(roof.sales).toBe(c.total);
    expect(roof.discountPct).toBeGreaterThan(0);
    expect(roof.voidPct).toBeGreaterThan(2);
    expect(league.branches[0]!.score).not.toBeNull();

    // Voids over the usual 2 % are an exception, named with the branch's manager; a wider range clears it.
    type Ex = { exceptions: { branch: string; key: string; value: number; limit: number }[] };
    const ex = await ok<Ex>(w.api.get(`/api/owner/exceptions${span}`));
    expect(ex.exceptions.find((e) => e.branch === 'Rooftop Jaipur' && e.key === 'voidPct')).toMatchObject({
      limit: 2,
    });
    await ok(w.api.put('/api/owner/ranges', { branchId: r.g.b.rooftop.id, ranges: { voidPct: 90 } }));
    const after = await ok<Ex>(w.api.get(`/api/owner/exceptions${span}`));
    expect(after.exceptions.some((e) => e.branch === 'Rooftop Jaipur' && e.key === 'voidPct')).toBe(false);

    const leak = await ok<{
      totals: { voids: number; discounts: number };
      people: { name: string; voids: number; discounts: number }[];
      voidReasons: { reason: string }[];
    }>(w.api.get(`/api/owner/leaks${span}`));
    expect(leak.totals.voids).toBe(280_00);
    expect(leak.totals.discounts).toBeGreaterThan(0);
    expect(leak.people.find((p) => p.name === 'Meera Manager')!.voids).toBe(280_00);
    expect(leak.voidReasons[0]!.reason).toBe('Guest changed their mind');

    // The other pages answer, and none of it is open to a steward.
    for (const path of ['promises', 'delay', 'bus-factor', 'vendors', 'cash-flow', 'morning'])
      expect((await w.api.get(`/api/owner/${path}`)).status, path).toBe(200);
    expect((await s.get('/api/owner/leaks')).status).toBe(403);
    expect((await s.get('/api/owner/morning')).status).toBe(403);
  }, 90_000);

  it('promises: work done by its date is kept, late work and moved dates are not', async () => {
    const w = await world(ctx.app);
    const asha = await w.person('Asha Keeper');
    const ravi = await w.person('Ravi Slipper');
    const give = async (doerId: string, hours: number) =>
      (
        await ok<{ id: string }>(
          w.api.post('/api/tasks', {
            doerId,
            plannedAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
            description: 'Count the store',
          }),
        )
      ).id;
    const a = await give(asha.id, 5);
    await ok(asha.api.post(`/api/tasks/${a}/actions`, { action: 'accept' }));
    await ok(asha.api.post(`/api/tasks/${a}/actions`, { action: 'markDone', note: 'Counted and matched' }));
    const b = await give(ravi.id, -5); // already late
    await ok(ravi.api.post(`/api/tasks/${b}/actions`, { action: 'accept' }));
    await ok(
      ravi.api.post(`/api/tasks/${b}/actions`, {
        action: 'moveDate',
        plannedAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        reason: 'Waiting for the vendor',
      }),
    );
    const far = new Date(Date.now() + 5 * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const p = await ok<{
      people: { name: string; due: number; kept: number; moved: number; keptPct: number | null }[];
    }>(w.api.get(`/api/owner/promises?from=${today()}&to=${far}`));
    expect(p.people.find((x) => x.name === 'Asha Keeper')).toMatchObject({ due: 1, kept: 1, keptPct: 100 });
    expect(p.people.find((x) => x.name === 'Ravi Slipper')).toMatchObject({ moved: 1 });
  }, 60_000);

  it('a second company is shown only after its owner signs in to it from here', async () => {
    const one = await ownerClient(ctx.app);
    const two = await ownerClient(ctx.app);
    type Morning = { companies: { name: string; mine: boolean }[]; linked: number };
    expect((await ok<Morning>(one.api.get('/api/owner/morning'))).companies).toHaveLength(1);
    // A wrong password links nothing.
    expect(
      (await one.api.post('/api/owner/companies', { identifier: two.mobile, password: 'wrong-password' }))
        .status,
    ).toBe(401);
    expect((await ok<Morning>(one.api.get('/api/owner/morning'))).linked).toBe(0);
    await ok(one.api.post('/api/owner/companies', { identifier: two.mobile, password: two.password }));
    const both = await ok<Morning>(one.api.get('/api/owner/morning'));
    expect(both.companies.map((c) => c.mine)).toEqual([true, false]);
    expect(both.companies[1]!.name).toBe(two.company.name);
    // The other side sees nothing of the first until it links back itself.
    expect((await ok<Morning>(two.api.get('/api/owner/morning'))).companies).toHaveLength(1);
    await ok(one.api.del(`/api/owner/companies/${two.company.id}`));
    expect((await ok<Morning>(one.api.get('/api/owner/morning'))).companies).toHaveLength(1);
  }, 60_000);

  it('shadow mode: the owner sees what a person sees, read-only; nobody else can', async () => {
    const w = await world(ctx.app);
    const asha = await w.person('Asha Seen');
    const as = { 'x-mono-view-as': asha.id };
    // Started through the desk (and audited), then every read answers as her.
    expect((await w.api.post('/api/owner/view-as', { userId: asha.id })).body).toMatchObject({
      name: 'Asha Seen',
    });
    const me = await w.api.get('/api/auth/me', as);
    expect(me.body.user).toMatchObject({ id: asha.id, name: 'Asha Seen' });
    // Her rights, not the owner's: the owner's desk is closed to her.
    expect((await w.api.get('/api/owner/leaks', as)).status).toBe(403);
    expect((await w.api.get('/api/tasks?scope=mine&tab=pending', as)).status).toBe(200);
    // Looking never changes anything.
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/ea/items',
      headers: { cookie: await ownerCookie(w), origin: 'http://localhost:5173', 'x-mono-view-as': asha.id },
      payload: { text: 'Should not be saved' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.message).toContain('read-only');
    // A member cannot look as the owner.
    expect((await asha.api.get('/api/auth/me', { 'x-mono-view-as': w.owner.id })).status).toBe(403);
    expect((await asha.api.post('/api/owner/view-as', { userId: w.owner.id })).status).toBe(403);
  }, 60_000);

  it('the weekly letter, the what-if base and copying a branch’s checklists', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const letter = await ok<{ week: { from: string; to: string } }>(w.api.get('/api/owner/letter'));
    expect(letter.week.from < letter.week.to).toBe(true);
    const base = await ok<{ weekdays: unknown[] }>(w.api.get('/api/owner/what-if'));
    expect(base.weekdays).toHaveLength(7);

    // The rooftop's checklist is made again for the garden, for the garden's manager.
    await ok(
      w.api.post('/api/checklists/masters', {
        name: 'Opening checklist — Rooftop Jaipur',
        branchId: r.g.b.rooftop.id,
        items: [{ key: 'i1', text: 'Tables wiped' }],
        frequency: { type: 'daily' },
        dueTime: '16:00',
        windowHours: 3,
        doerIds: [r.steward.id],
        skipHolidays: false,
        startDate: today(),
      }),
    );
    const copy = (to: string) =>
      w.api.post('/api/owner/copy-checklists', { fromBranchId: r.g.b.rooftop.id, toBranchId: to });
    // No manager at the garden yet: nothing is copied, and it says why.
    expect((await copy(r.g.b.garden.id)).body).toMatchObject({ copied: 0, reason: 'manager' });
    await ok(
      w.api.put('/api/branches/managers', {
        branchId: r.g.b.garden.id,
        role: 'MANAGER',
        userIds: [r.manager.id],
      }),
    );
    expect((await copy(r.g.b.garden.id)).body).toMatchObject({ copied: 1 });
    expect((await copy(r.g.b.garden.id)).body).toMatchObject({ copied: 0 });
    const made = await ctx.prisma.checklistMaster.findFirstOrThrow({
      where: { companyId: w.companyId, branchId: r.g.b.garden.id },
    });
    expect(made).toMatchObject({ name: 'Opening checklist — Garden Jaipur', doerIds: [r.manager.id] });
    await ctx.prisma.checklistMaster.updateMany({
      where: { companyId: w.companyId },
      data: { active: false },
    });
    expect(
      (
        await r.steward.api.post('/api/owner/copy-checklists', {
          fromBranchId: r.g.b.rooftop.id,
          toBranchId: r.g.b.garden.id,
        })
      ).status,
    ).toBe(403);
  }, 90_000);

  it('the pulse: a guest rates from the table’s link; a low score becomes the manager’s task', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    await ok(
      w.api.put('/api/branches/managers', {
        branchId: r.g.b.rooftop.id,
        role: 'MANAGER',
        userIds: [r.manager.id],
      }),
    );
    const s = r.steward.api;
    const o = await open(s, r, 'T1');
    await add(s, o.id, [{ menuItemId: r.m.dal }]);
    const c = await bill(s, o.id);
    type Pulse = {
      count: number;
      average: number | null;
      low: number;
      outlets: { outlet: string; link: string; count: number }[];
      stewards: { name: string; average: number }[];
    };
    const before = await ok<Pulse>(w.api.get('/api/owner/pulse'));
    const link = before.outlets.find((x) => x.outlet === 'Rooftop')!.link;
    const url = `/api/public${link}`;
    const guest = (method: 'GET' | 'POST', path: string, payload?: object) =>
      ctx.app.inject({
        method,
        url: path,
        headers: { origin: 'http://localhost:5173' },
        ...(payload ? { payload } : {}),
      });
    expect((await guest('GET', url)).json()).toMatchObject({ outlet: 'Rooftop' });
    expect((await guest('GET', '/api/public/pulse/nope.nope1234')).statusCode).toBe(404);
    expect((await guest('POST', url, { stars: 5, comment: 'Lovely evening' })).statusCode).toBe(200);
    expect(
      (await guest('POST', url, { stars: 1, comment: 'Waited 40 minutes', billNo: c.number })).statusCode,
    ).toBe(200);
    // A robot that fills the hidden field is thanked and ignored.
    expect((await guest('POST', url, { stars: 1, website: 'spam.example' })).statusCode).toBe(200);
    expect((await guest('POST', url, { stars: 9 })).statusCode).toBe(400);

    const after = await ok<Pulse>(w.api.get('/api/owner/pulse'));
    expect(after).toMatchObject({ count: 2, average: 3, low: 1 });
    expect(after.stewards[0]).toMatchObject({ name: 'Ravi Steward', average: 1 });
    const task = await ctx.prisma.task.findFirstOrThrow({
      where: { companyId: w.companyId, source: 'pulse' },
    });
    expect(task.doerId).toBe(r.manager.id);
    expect(task.description).toContain('Waited 40 minutes');
    expect((await s.get('/api/owner/pulse')).status).toBe(403);
  }, 90_000);

  it('a surprise check: a ticked item must be shown again with a new photo, and somebody else judges it', async () => {
    const w = await world(ctx.app);
    const asha = await w.person('Asha Doer');
    const vik = await w.person('Vik Verifier', 'HOD');
    await ok(
      w.api.post('/api/checklists/masters', {
        name: 'Closing checklist',
        items: [{ key: 'i1', text: 'Gas valves closed' }],
        frequency: { type: 'daily' },
        dueTime: '23:00',
        windowHours: 4,
        doerIds: [asha.id],
        verifierId: vik.id,
        skipHolidays: false,
        startDate: today(),
      }),
    );
    const run = (await ok<{ runs: { id: string }[] }>(asha.api.get('/api/checklists/runs?scope=mine')))
      .runs[0]!;
    const item = (await ctx.prisma.checklistRunItem.findFirstOrThrow({ where: { runId: run.id } })).id;
    const photo = (when: Date) =>
      ctx.prisma.attachment
        .create({
          data: {
            companyId: w.companyId,
            entityType: 'upload',
            entityId: asha.id,
            path: `t/${Math.random()}.jpg`,
            originalName: 'p.jpg',
            mime: 'image/jpeg',
            size: 1,
            uploadedById: asha.id,
            createdAt: when,
          },
        })
        .then((a) => a.id);
    const old = await photo(new Date(Date.now() - 3_600_000));
    // Nothing ticked yet: nothing to ask about.
    expect((await w.api.post('/api/owner/spot-checks/ask')).body).toEqual({ asked: false });
    await ok(asha.api.post(`/api/checklists/runs/${run.id}/items`, { itemId: item, done: true }));
    expect((await w.api.post('/api/owner/spot-checks/ask')).body).toEqual({ asked: true });
    // One check per run a day.
    expect((await w.api.post('/api/owner/spot-checks/ask')).body).toEqual({ asked: false });

    type Mine = { answer: { id: string; text: string }[]; judge: { id: string; doer: string }[] };
    const mine = await ok<Mine>(asha.api.get('/api/spot-checks/mine'));
    expect(mine.answer).toHaveLength(1);
    expect(mine.answer[0]!.text).toBe('Gas valves closed');
    const id = mine.answer[0]!.id;
    // A photo from before the question is refused; one taken now is taken.
    expect(
      (await asha.api.post(`/api/spot-checks/${id}/answer`, { attachmentId: old })).body.error.message,
    ).toContain('new photo');
    await ok(asha.api.post(`/api/spot-checks/${id}/answer`, { attachmentId: await photo(new Date()) }));
    // She cannot judge it herself; the verifier can, and "not OK" needs a word.
    expect((await asha.api.post(`/api/spot-checks/${id}/decide`, { ok: true })).status).toBe(403);
    expect((await ok<Mine>(vik.api.get('/api/spot-checks/mine'))).judge[0]).toMatchObject({
      id,
      doer: 'Asha Doer',
    });
    expect((await vik.api.post(`/api/spot-checks/${id}/decide`, { ok: false })).status).toBe(400);
    await ok(vik.api.post(`/api/spot-checks/${id}/decide`, { ok: false, note: 'Valve two was open' }));
    const desk = await ok<{
      people: { name: string; asked: number; notOk: number }[];
      latest: { status: string; note: string | null }[];
    }>(w.api.get('/api/owner/spot-checks'));
    expect(desk.people[0]).toMatchObject({ name: 'Asha Doer', asked: 1, notOk: 1 });
    expect(desk.latest[0]).toMatchObject({ status: 'NOT_OK', note: 'Valve two was open' });
    await ctx.prisma.checklistMaster.updateMany({
      where: { companyId: w.companyId },
      data: { active: false },
    });
  }, 90_000);
});

/** The owner's session cookie, for a raw request with extra headers. */
async function ownerCookie(w: Awaited<ReturnType<typeof world>>) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: 'http://localhost:5173' },
    payload: { identifier: w.mobile, password: w.password },
  });
  return (res.cookies as { name: string; value: string }[]).map((c) => `${c.name}=${c.value}`).join('; ');
}
