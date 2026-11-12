import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { give, group, ok, reachOf, tasks, type World } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('branches, regions, entities and reach (phase 12, stage A)', () => {
  it('G1: the structure is set up through the API — entity, regions to any depth, branches of a type, locations', async () => {
    const w = await world(ctx.app);
    const g = await group(w);
    await ok(w.api.post('/api/branches/locations', { name: 'Main store', branchId: g.b.kitchen.id }));
    await ok(
      w.api.post('/api/branches/locations', {
        name: 'Cold room',
        branchId: g.b.kitchen.id,
        kind: 'COLD_ROOM',
      }),
    );
    const s = await ok<{
      entities: { name: string; isDefault: boolean; country: string; currency: string }[];
      regions: { name: string; parentId: string | null }[];
      branches: { name: string; type: string; entityId: string; regionId: string; people: number }[];
      locations: { name: string; kind: string }[];
    }>(w.api.get('/api/branches/structure'));
    expect(s.entities).toMatchObject([
      { name: 'GGM Hotels Rajasthan', isDefault: true, country: 'IN', currency: 'INR' },
    ]);
    expect(s.regions.map((r) => [r.name, r.parentId === g.raj.id])).toEqual([
      ['Ajmer', true],
      ['Jaipur', true],
      ['Rajasthan', false],
    ]);
    expect(s.branches.find((x) => x.name === 'Central Kitchen')).toMatchObject({
      type: 'KITCHEN',
      entityId: g.entity.id,
      regionId: g.ajmer.id,
    });
    expect(s.locations.map((l) => [l.name, l.kind])).toEqual([
      ['Cold room', 'COLD_ROOM'],
      ['Main store', 'STORE'],
    ]);

    // Names are unique where they must be; nothing in use can be removed; nothing loops.
    expect((await w.api.post('/api/branches/entities', { name: 'ggm hotels rajasthan' })).status).toBe(409);
    expect(
      (await w.api.post('/api/branches/locations', { name: 'main store', branchId: g.b.kitchen.id })).status,
    ).toBe(409);
    expect((await w.api.del(`/api/branches/entities/${g.entity.id}`)).status).toBe(409);
    expect((await w.api.del(`/api/branches/regions/${g.raj.id}`)).status).toBe(409);
    expect(
      (await w.api.patch(`/api/branches/regions/${g.raj.id}`, { name: 'Rajasthan', parentId: g.jaipur.id }))
        .status,
    ).toBe(400);
    expect((await w.api.post('/api/org/branches', { name: 'Nowhere', regionId: 'nope' })).status).toBe(404);
    expect(
      (await w.api.post('/api/org/branches', { name: 'Odd clock', timezone: 'Mars/Phobos' })).status,
    ).toBe(400);
    // Only the people who set the company up may change it; another company sees none of it.
    const member = await w.person('Gopal Prajapat');
    expect((await member.api.post('/api/branches/regions', { name: 'Mine' })).status).toBe(403);
    const other = await world(ctx.app);
    expect((await other.api.get('/api/branches/structure')).body.entities).toEqual([]);
    expect(
      (await other.api.post('/api/branches/locations', { name: 'X', branchId: g.b.kitchen.id })).status,
    ).toBe(404);
  });

  it('G2 G3 G5: managers, area managers and reach — each person sees the work of their own branches only', async () => {
    const w = await world(ctx.app);
    const g = await group(w);
    const cooks = {
      rooftop: await g.at('Asha Rooftop', g.b.rooftop.id),
      garden: await g.at('Bala Garden', g.b.garden.id),
      lake: await g.at('Chitra Lake', g.b.lake.id),
      kitchen: await g.at('Dev Kitchen', g.b.kitchen.id),
    };
    // One task for someone at each branch, and one for a person with no branch (group-wide).
    await give(w, cooks.rooftop.id, 'Deep-clean the rooftop bar');
    await give(w, cooks.garden.id, 'Fix the garden lights');
    await give(w, cooks.lake.id, 'Count the lake-view linen');
    await give(w, cooks.kitchen.id, 'Check the cold room log');
    const nobody = await w.person('Esha Floating');
    await give(w, nobody.id, 'Renew the fire licence');

    // HODs here may see every task (so only reach limits them) and are "my branches" people; the owner stays
    // "whole group".
    const hod = await ctx.prisma.role.findUniqueOrThrow({ where: { id: w.role('HOD') } });
    await ok(
      w.api.patch(`/api/org/roles/${hod.id}`, { permissions: [...hod.permissions, 'delegation.admin'] }),
    );
    await reachOf(w, 'HOD', 'branches');
    const manager = await g.at('Farah Manager', g.b.rooftop.id, 'HOD');
    const area = await w.person('Gita Area', 'HOD');
    await ok(
      w.api.put('/api/branches/managers', { regionId: g.jaipur.id, role: 'AREA', userIds: [area.id] }),
    );
    const twoHats = await w.person('Hari Twohats', 'HOD');
    await ok(
      w.api.put('/api/branches/managers', { branchId: g.b.lake.id, role: 'MANAGER', userIds: [twoHats.id] }),
    );
    await ok(
      w.api.put('/api/branches/managers', {
        branchId: g.b.kitchen.id,
        role: 'MANAGER',
        userIds: [twoHats.id],
      }),
    );

    const all = [
      'Check the cold room log',
      'Count the lake-view linen',
      'Deep-clean the rooftop bar',
      'Fix the garden lights',
      'Renew the fire licence',
    ];
    expect(await tasks(w.api)).toEqual(all);
    // A branch manager: their branch, and what belongs to no branch.
    expect(await tasks(manager.api)).toEqual(['Deep-clean the rooftop bar', 'Renew the fire licence']);
    // An area manager over the Jaipur region: both Jaipur outlets, not Ajmer.
    expect(await tasks(area.api)).toEqual([
      'Deep-clean the rooftop bar',
      'Fix the garden lights',
      'Renew the fire licence',
    ]);
    // One person managing two branches sees both.
    expect(await tasks(twoHats.api)).toEqual([
      'Check the cold room log',
      'Count the lake-view linen',
      'Renew the fire licence',
    ]);
    // A task of another branch can't be opened by its id either …
    const hidden = await ctx.prisma.task.findFirstOrThrow({
      where: { companyId: w.companyId, description: 'Count the lake-view linen' },
    });
    expect((await manager.api.get(`/api/tasks/${hidden.id}`)).status).toBe(404);
    // … unless the person is part of it: a task given to the manager by someone at another branch is theirs.
    await give(w, manager.id, 'Send the monthly report');
    await ctx.prisma.task.updateMany({
      where: { companyId: w.companyId, description: 'Send the monthly report' },
      data: { branchId: g.b.lake.id },
    });
    expect(await tasks(manager.api)).toContain('Send the monthly report');

    // "My entity" widens to every branch of the entity; the switcher narrows to one and never widens.
    await reachOf(w, 'HOD', 'entity');
    expect(await tasks(manager.api)).toEqual([...all, 'Send the monthly report'].sort());
    await reachOf(w, 'HOD', 'branches');
    const mine = await ok<{ branches: { name: string }[]; wholeGroup: boolean }>(
      area.api.get('/api/branches/mine'),
    );
    expect(mine).toMatchObject({ wholeGroup: false });
    expect(mine.branches.map((x) => x.name).sort()).toEqual(['Garden Jaipur', 'Rooftop Jaipur']);
    expect((await ok<{ wholeGroup: boolean }>(w.api.get('/api/branches/mine'))).wholeGroup).toBe(true);
    const narrowed = async (api: World['api'], branchId: string) =>
      (
        await ok<{ tasks: { description: string }[] }>(
          api.get('/api/tasks?scope=all&tab=all', { 'x-mono-branch': branchId }),
        )
      ).tasks
        .map((t) => t.description)
        .sort();
    expect(await narrowed(area.api, g.b.garden.id)).toEqual([
      'Fix the garden lights',
      'Renew the fire licence',
    ]);
    expect(await narrowed(area.api, g.b.lake.id)).toEqual([
      'Deep-clean the rooftop bar',
      'Fix the garden lights',
      'Renew the fire licence',
    ]);
    // The owner narrowed to one branch sees that branch only (the report task was moved to it above).
    expect(await narrowed(w.api, g.b.lake.id)).toEqual([
      'Count the lake-view linen',
      'Renew the fire licence',
      'Send the monthly report',
    ]);
  });
});
