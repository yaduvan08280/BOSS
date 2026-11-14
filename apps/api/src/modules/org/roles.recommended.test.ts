import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Plan = {
  roles: { name: string; isNew: boolean; reachFrom: string | null; reachTo: string; loses: string[] }[];
  moves: { name: string; to: string }[];
};

describe('recommended access', () => {
  it('previews, then narrows roles and moves Members to the role of their work — once', async () => {
    const w = await world(ctx.app);
    const sales = (await w.api.post('/api/org/departments', { name: 'Sales' })).body.id as string;
    const guard = (await w.api.post('/api/org/departments', { name: 'Security' })).body.id as string;
    const seller = await w.person('Sita Seller');
    const watch = await w.person('Gopal Guard');
    await ctx.app.prisma.user.update({ where: { id: seller.id }, data: { mainDepartmentId: sales } });
    await ctx.app.prisma.user.update({ where: { id: watch.id }, data: { mainDepartmentId: guard } });
    const own = (
      await w.api.post('/api/org/roles', { name: 'Gate keeper', permissions: ['org.view', 'ims.view'] })
    ).body;

    // Only an admin may look or apply.
    expect((await seller.api.get('/api/org/roles/recommended')).status).toBe(403);
    const plan = (await w.api.get('/api/org/roles/recommended')).body as Plan;
    const member = plan.roles.find((r) => r.name === 'Member')!;
    expect(member).toMatchObject({ reachFrom: 'group', reachTo: 'branches' });
    expect(member.loses).toEqual(expect.arrayContaining(['crm', 'ims', 'hosp']));
    expect(plan.roles.find((r) => r.name === 'Sales staff')).toMatchObject({ isNew: true });
    expect(plan.roles.find((r) => r.name === 'Gate keeper')).toMatchObject({
      reachTo: 'branches',
      loses: [],
    });
    expect(plan.roles.some((r) => r.name === 'Owner')).toBe(false);
    expect(plan.moves).toEqual([expect.objectContaining({ name: 'Sita Seller', to: 'Sales staff' })]);
    // Nothing was saved by looking.
    expect((await seller.api.get('/api/crm/customers')).status).toBe(200);

    expect((await w.api.post('/api/org/roles/recommended')).body).toMatchObject({ moved: 1 });
    // The seller keeps the sales screens through the new role; the guard no longer opens them.
    expect((await seller.api.get('/api/crm/customers')).status).toBe(200);
    expect((await watch.api.get('/api/crm/customers')).status).toBe(403);
    expect((await watch.api.get('/api/tasks/tiles')).status).toBe(200);
    // A company's own role keeps its rights.
    const roles = (await w.api.get('/api/org/roles')).body.roles as {
      id: string;
      reach: string;
      permissions: string[];
    }[];
    expect(roles.find((r) => r.id === own.id)).toMatchObject({
      reach: 'branches',
      permissions: ['ims.view', 'org.view'],
    });
    // A second look finds nothing left to do.
    expect((await w.api.get('/api/org/roles/recommended')).body).toEqual({ roles: [], moves: [] });
  }, 90_000);
});
