import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { makeRecord, makeType, world } from '../records/testkit';
import { give, group, ok, tasks, type World } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/** The hotel group plus a franchise partner with one outlet, its owner-manager and a waiter. */
async function withFranchise(w: World) {
  const g = await group(w);
  const partner = await ok<{ id: string }>(
    w.api.post('/api/branches/entities', { name: 'Kota Foods (franchise)', kind: 'FRANCHISE' }),
  );
  const kota = await ok<{ id: string }>(
    w.api.post('/api/org/branches', { name: 'Kota Outlet', type: 'OUTLET', entityId: partner.id }),
  );
  // The franchise's own manager holds a wide role — it must not matter.
  const boss = await g.at('Kiran Kota', kota.id, 'ADMIN');
  const waiter = await g.at('Waiter Kota', kota.id);
  const cook = await g.at('Cook Rooftop', g.b.rooftop.id);
  return { g, partner, kota, boss, waiter, cook };
}

describe('franchises (phase 12, stage D)', () => {
  it('G39: a franchise is walled off — its people see nothing beyond it; group people need the oversight right', async () => {
    const w = await world(ctx.app);
    const f = await withFranchise(w);
    await give(w, f.cook.id, 'Clean the rooftop grill');
    await give(w, f.waiter.id, 'Polish the Kota cutlery');
    await give(w, w.owner.id, 'Sign the lease');
    // The franchise's manager is an Admin by role — and still sees only the franchise's work, not even what is
    // group-wide.
    expect(await tasks(f.boss.api)).toEqual(['Polish the Kota cutlery']);
    // Its people, branches and entity are the only ones they can list.
    const people = (await ok<{ name: string }[]>(f.boss.api.get('/api/org/users'))).map((p) => p.name).sort();
    expect(people).toEqual(['Kiran Kota', 'Waiter Kota']);
    const s = await ok<{ branches: { name: string }[]; entities: { name: string }[] }>(
      f.boss.api.get('/api/branches/structure'),
    );
    expect(s.branches.map((b) => b.name)).toEqual(['Kota Outlet']);
    expect(s.entities.map((e) => e.name)).toEqual(['Kota Foods (franchise)']);
    // They can't change the group's structure, nor give work to someone outside.
    expect((await f.boss.api.post('/api/branches/regions', { name: 'Mine' })).status).toBe(403);
    const outside = await f.boss.api.post('/api/tasks', {
      doerId: f.cook.id,
      plannedAt: new Date(Date.now() + 86_400_000).toISOString(),
      description: 'Come work for us',
    });
    expect(outside.status).toBeGreaterThanOrEqual(400);
    // …and are told why: the cook is active, just outside the branches they can reach.
    expect(outside.body.error.message).toMatch(/outside the ones you can reach/);

    // A group admin without the oversight right sees the group, not the franchise.
    const admin = await ctx.prisma.role.findUniqueOrThrow({ where: { id: w.role('ADMIN') } });
    const plain = await ok<{ id: string }>(
      w.api.post('/api/org/roles', {
        name: 'Group admin, no franchises',
        permissions: admin.permissions.filter((p) => !p.startsWith('franchise.')),
      }),
    );
    const viewer = await w.person('Gita Group', plain.id);
    expect(await tasks(viewer.api)).toEqual(['Clean the rooftop grill', 'Sign the lease']);
    const seen = (await ok<{ name: string }[]>(viewer.api.get('/api/org/users'))).map((p) => p.name);
    expect(seen).toContain('Cook Rooftop');
    expect(seen).not.toContain('Waiter Kota');
    // Giving the franchise's waiter a task says they are out of reach, not inactive.
    const toWaiter = await viewer.api.post('/api/tasks', {
      doerId: f.waiter.id,
      plannedAt: new Date(Date.now() + 86_400_000).toISOString(),
      description: 'Send the brand audit plan',
    });
    expect(toWaiter.status).toBe(400);
    expect(toWaiter.body.error.message).toMatch(/outside the ones you can reach/);
    const mine = await ok<{ branches: { name: string }[] }>(viewer.api.get('/api/branches/mine'));
    expect(mine.branches.map((b) => b.name)).not.toContain('Kota Outlet');
    // With the right (a built-in Admin has it), and for the owner, everything is there.
    const overseer = await w.person('Omar Oversight', 'ADMIN');
    expect(await tasks(overseer.api)).toEqual([
      'Clean the rooftop grill',
      'Polish the Kota cutlery',
      'Sign the lease',
    ]);
    expect(await tasks(w.api)).toHaveLength(3);
  });

  it('G40: brand content is shared with franchises read-only', async () => {
    const w = await world(ctx.app);
    const f = await withFranchise(w);
    const recipes = await ok<{ id: string }>(w.api.post('/api/masters/library/vendors', {}));
    const add = (api: World['api'], name: string, more: object = {}) =>
      api.post(`/api/masters/${recipes.id}/rows`, {
        code: name.toUpperCase().replace(/\W/g, '-'),
        name,
        ...more,
      });
    await ok(add(w.api, 'Approved Dairy'));
    const names = async (api: World['api']) =>
      (await ok<{ rows: { label: string }[] }>(api.get(`/api/masters/${recipes.id}/rows`))).rows.map(
        (r) => r.label,
      );
    // Not shared: the franchise sees none of the group's rows.
    expect(await names(f.boss.api)).toEqual([]);
    // Only the group (with the franchise right) shares brand content.
    const share = (api: World['api'], body: object) => api.put('/api/branches/brand', body);
    expect((await share(f.boss.api, { kind: 'master', id: recipes.id, shared: true })).status).toBe(403);
    await ok(share(w.api, { kind: 'master', id: recipes.id, shared: true }));
    expect(await names(f.boss.api)).toEqual(['Approved Dairy']);
    // Read-only: the franchise can add its own rows, but not change or delete the brand's, nor the master itself.
    await ok(add(f.boss.api, 'Kota Greens', { _branchId: f.kota.id }));
    expect((await names(f.boss.api)).sort()).toEqual(['Approved Dairy', 'Kota Greens']);
    const brandRow = await ctx.prisma.masterRow.findFirstOrThrow({
      where: { masterId: recipes.id, label: 'Approved Dairy' },
    });
    expect(
      (
        await f.boss.api.put(`/api/masters/${recipes.id}/rows/${brandRow.id}`, {
          code: 'APPROVED-DAIRY',
          name: 'Ours now',
        })
      ).status,
    ).toBe(403);
    expect((await f.boss.api.del(`/api/masters/${recipes.id}/rows/${brandRow.id}`)).status).toBe(403);
    expect((await add(f.boss.api, 'For everyone', { _branchId: null })).status).toBe(403);
    // The franchise's own rows stay the franchise's: the rooftop does not see them.
    expect(await names(f.cook.api)).toEqual(['Approved Dairy']);
    // Unsharing takes the brand rows away again; records of the group were never visible.
    await ok(share(w.api, { kind: 'master', id: recipes.id, shared: false }));
    expect(await names(f.boss.api)).toEqual(['Kota Greens']);
    const typeId = await makeType(w.api);
    await makeRecord(w.api, typeId, { site: 'Group policy' });
    const list = await f.boss.api.get(`/api/records/types/${typeId}/records`);
    expect(list.status === 200 ? (list.body as { total: number }).total : 0).toBe(0);
  });
  it("G41: royalty is a share of the month's sales and / or a fixed fee, never under the minimum; invoiced once a month", async () => {
    const w = await world(ctx.app);
    const f = await withFranchise(w);
    const { royaltyFor } = await import('../franchise/royalty');
    // The rule itself.
    expect(royaltyFor({ royaltyPercent: 6 }, 10_00_000_00)).toEqual({
      royalty: 60_000_00,
      fixed: 0,
      amount: 60_000_00,
      minimumUsed: false,
    });
    expect(royaltyFor({ royaltyPercent: 6, fixedMonthlyPaise: 5_000_00 }, 10_00_000_00).amount).toBe(
      65_000_00,
    );
    expect(royaltyFor({ royaltyPercent: 6, minimumPaise: 25_000_00 }, 1_00_000_00)).toMatchObject({
      amount: 25_000_00,
      minimumUsed: true,
    });
    // Last month: the franchise sold ₹2,00,000; a cancelled order and the group's own sales don't count.
    const [y, m] = new Date().toISOString().slice(0, 7).split('-').map(Number) as [number, number];
    const month = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
    const customer = await ctx.prisma.customer.create({
      data: { companyId: w.companyId, code: 'CUS-T', name: 'Walk-in' },
    });
    let n = 0;
    const order = (branchId: string | null, amount: number, status = 'OPEN') =>
      ctx.prisma.salesOrder.create({
        data: {
          companyId: w.companyId,
          branchId,
          number: `SO/T/${++n}`,
          customerId: customer.id,
          orderDate: `${month}-10`,
          dueOn: `${month}-20`,
          amount: BigInt(amount),
          status,
        },
      });
    await order(f.kota.id, 1_50_000_00);
    await order(f.kota.id, 50_000_00);
    await order(f.kota.id, 9_00_000_00, 'CANCELLED');
    await order(f.g.b.rooftop.id, 7_00_000_00);
    const raise = (api: World['api']) =>
      api.post('/api/franchise/royalties', { entityId: f.partner.id, month });
    // No terms yet: nothing to invoice. Then 6% with a ₹10,000 minimum.
    expect((await raise(w.api)).status).toBe(409);
    await ok(
      w.api.patch(`/api/branches/entities/${f.partner.id}`, {
        name: 'Kota Foods (franchise)',
        kind: 'FRANCHISE',
        details: { franchise: { royaltyPercent: 6, minimumPaise: 10_000_00, agreementEnd: '2031-03-31' } },
      }),
    );
    // Only the brand team raises it — not the franchise itself.
    expect((await raise(f.waiter.api)).status).toBe(403);
    const inv = await ok<{
      id: string;
      number: string;
      salesPaise: number;
      amountPaise: number;
      minimumUsed: boolean;
    }>(raise(w.api));
    expect(inv).toMatchObject({ salesPaise: 2_00_000_00, amountPaise: 12_000_00, minimumUsed: false });
    expect(inv.number).toMatch(/^ROY\/\d\d-\d\d\/0001$/);
    // Asking again gives the same invoice; this month (not over) can't be invoiced.
    expect((await ok<{ id: string }>(raise(w.api))).id).toBe(inv.id);
    const thisMonth = new Date().toISOString().slice(0, 7);
    expect(
      (await w.api.post('/api/franchise/royalties', { entityId: f.partner.id, month: thisMonth })).status,
    ).toBe(400);
    // The franchise sees its own invoices; the rooftop cook sees none of this.
    const theirs = await ok<{ number: string }[]>(f.boss.api.get('/api/franchise/royalties'));
    expect(theirs.map((x) => x.number)).toEqual([inv.number]);
    expect((await f.cook.api.get('/api/franchise/royalties')).status).toBe(403);
    await ok(w.api.post(`/api/franchise/royalties/${inv.id}/status`, { status: 'PAID' }));
    expect(
      (await w.api.post(`/api/franchise/royalties/${inv.id}/status`, { status: 'CANCELLED' })).status,
    ).toBe(409);
  });

  it('G42: a brand audit scores an outlet and turns every failed point into a task for its manager', async () => {
    const w = await world(ctx.app);
    const f = await withFranchise(w);
    await ok(
      w.api.put('/api/branches/managers', { branchId: f.kota.id, role: 'MANAGER', userIds: [f.boss.id] }),
    );
    const audit = {
      branchId: f.kota.id,
      title: 'Quarterly hygiene audit',
      correctWithinDays: 5,
      items: [
        { text: 'Hand-wash station stocked', ok: true },
        { text: 'Cold room at or below 5°C', ok: false, note: 'Reading 9°C' },
        { text: 'Staff in uniform', ok: true },
        { text: 'FSSAI licence displayed', ok: false },
      ],
    };
    // The franchise can't audit itself.
    expect((await f.boss.api.post('/api/franchise/audits', audit)).status).toBe(403);
    const done = await ok<{ id: string; score: number; tasks: string[] }>(
      w.api.post('/api/franchise/audits', audit),
    );
    expect(done.score).toBe(50);
    expect(done.tasks).toHaveLength(2);
    const made = await ctx.prisma.task.findMany({
      where: { id: { in: done.tasks } },
      orderBy: { number: 'asc' },
    });
    // Each is the outlet manager's, belongs to the outlet, needs proof, and is due in five days.
    expect(made.map((t) => [t.doerId, t.branchId, t.requireProof])).toEqual([
      [f.boss.id, f.kota.id, true],
      [f.boss.id, f.kota.id, true],
    ]);
    expect(made[0]!.description).toContain('Cold room at or below 5°C — Reading 9°C');
    const days = Math.round((made[0]!.plannedAt.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(5);
    // The outlet sees its audit and its tasks; another outlet does not.
    const seen = await ok<{ title: string; score: number }[]>(f.boss.api.get('/api/franchise/audits'));
    expect(seen).toMatchObject([{ title: 'Quarterly hygiene audit', score: 50 }]);
    expect(await ok<unknown[]>(f.cook.api.get('/api/franchise/audits'))).toEqual([]);
    expect(await tasks(f.boss.api)).toHaveLength(2);
  });

  it('G43: licences and the franchise agreement are chased before they run out — 30 days, 7 days, and on the day', async () => {
    const w = await world(ctx.app);
    const f = await withFranchise(w);
    const { watchRenewals } = await import('../franchise/renewals');
    await ok(
      w.api.patch(`/api/branches/entities/${f.partner.id}`, {
        name: 'Kota Foods (franchise)',
        kind: 'FRANCHISE',
        details: { franchise: { agreementEnd: '2031-06-30' } },
      }),
    );
    await ok(
      w.api.patch(`/api/org/branches/${f.kota.id}`, {
        name: 'Kota Outlet',
        details: { licences: [{ name: 'FSSAI', number: '1220-KOTA', validTill: '2031-03-31' }] },
      }),
    );
    const at = (day: string) => watchRenewals(ctx.prisma, new Date(`${day}T06:00:00Z`), w.companyId);
    // Far away: nothing. 30 days before the licence: one reminder — and not again the next day.
    expect(await at('2031-01-15')).toBe(0);
    expect(await at('2031-03-01')).toBe(1);
    expect(await at('2031-03-02')).toBe(0);
    // 7 days before, and on the day; then silence.
    expect(await at('2031-03-24')).toBe(1);
    expect(await at('2031-03-31')).toBe(1);
    expect(await at('2031-04-05')).toBe(0);
    // The agreement gets its own reminder when its time comes.
    expect(await at('2031-06-01')).toBe(1);
    const sent = await ctx.prisma.domainEvent.findMany({
      where: { companyId: w.companyId, name: 'franchise.renewal_due' },
      orderBy: { occurredAt: 'asc' },
    });
    const told = sent.map(
      (e) => e.payload as { what: string; daysLeft: number; date: string; place: string },
    );
    expect(told.map((t) => [t.what, t.daysLeft])).toEqual([
      ['FSSAI licence', 30],
      ['FSSAI licence', 7],
      ['FSSAI licence', 0],
      ['Franchise agreement', 29],
    ]);
    expect(told[0]).toMatchObject({ date: '31/03/2031', place: 'Kota Outlet' });
  });

  it('G44: a franchise leaves with everything that is theirs, and is then archived', async () => {
    const w = await world(ctx.app);
    const f = await withFranchise(w);
    await give(w, f.waiter.id, 'Polish the Kota cutlery');
    await give(w, f.cook.id, 'Clean the rooftop grill');
    const { exportFranchise } = await import('../franchise/exit');
    const { actorFor } = await import('../work/actor');
    const { unzipSync, strFromU8 } = await import('fflate');
    const owner = (await actorFor(ctx.prisma, w.companyId, w.owner.id))!;
    const storage = {
      get: () => {
        throw new Error('no file');
      },
      put: async () => 0,
      remove: async () => undefined,
    };
    // Archiving before the export is refused: the package is theirs to keep.
    expect((await w.api.post(`/api/franchise/${f.partner.id}/archive`, {})).status).toBe(409);
    const { name, zip } = await exportFranchise(ctx.prisma, storage as never, owner, f.partner.id);
    expect(name).toMatch(/Kota_Foods.*-export\.zip$/);
    const files = unzipSync(new Uint8Array(zip));
    const read = (path: string) => JSON.parse(strFromU8(files[path]!)) as Record<string, unknown>[];
    // Theirs, and only theirs: the franchise's people and work — never the rooftop's, never a password.
    expect(
      read('data/people.json')
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Kiran Kota', 'Waiter Kota']);
    expect(JSON.stringify(read('data/people.json'))).not.toMatch(/passwordHash|telegramChatId/);
    expect(read('data/tasks.json').map((t) => t.description)).toEqual(['Polish the Kota cutlery']);
    expect(read('data/branches.json').map((b) => b.name)).toEqual(['Kota Outlet']);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as {
      entity: { name: string };
      counts: Record<string, number>;
    };
    expect(manifest).toMatchObject({
      entity: { name: 'Kota Foods (franchise)' },
      counts: { people: 2, tasks: 1, branches: 1 },
    });
    // Only the brand team exports and archives.
    expect((await f.boss.api.get(`/api/franchise/${f.partner.id}/export`)).status).toBe(403);
    const archived = await ok<{ people: number; branches: number }>(
      w.api.post(`/api/franchise/${f.partner.id}/archive`, {}),
    );
    expect(archived).toMatchObject({ people: 2, branches: 1 });
    // Its people can no longer use the app; the branch has left the structure; the history is still there.
    expect((await f.boss.api.get('/api/tasks?scope=all&tab=all')).status).toBe(401);
    const s = await ok<{ branches: { name: string }[]; entities: { name: string }[] }>(
      w.api.get('/api/branches/structure'),
    );
    expect(s.branches.map((b) => b.name)).not.toContain('Kota Outlet');
    expect(s.entities.map((e) => e.name)).not.toContain('Kota Foods (franchise)');
    expect(await tasks(w.api)).toContain('Polish the Kota cutlery');
    expect((await w.api.post(`/api/franchise/${f.partner.id}/archive`, {})).status).toBe(409);
  });
});
