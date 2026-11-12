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
});
