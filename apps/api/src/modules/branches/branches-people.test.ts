import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { group, ok } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Person = { id: string; branchId: string | null; branchName: string | null; alsoBranchIds: string[] };

describe('who works where', () => {
  it('the people list names each person’s branch; a team is moved together and the history is kept', async () => {
    const w = await world(ctx.app);
    const g = await group(w);
    const asha = await g.at('Asha Rooftop', g.b.rooftop.id);
    const ravi = await g.at('Ravi Rooftop', g.b.rooftop.id);
    const lone = await w.person('Lone Nobranch');
    await ok(
      w.api.put(`/api/branches/people/${asha.id}`, {
        homeBranchId: g.b.rooftop.id,
        alsoBranchIds: [g.b.lake.id],
      }),
    );
    const list = async () => (await ok<Person[]>(w.api.get('/api/org/users'))) as Person[];
    const of = async (id: string) => (await list()).find((p) => p.id === id)!;
    expect(await of(asha.id)).toMatchObject({ branchName: 'Rooftop Jaipur', alsoBranchIds: [g.b.lake.id] });
    expect(await of(lone.id)).toMatchObject({ branchId: null, branchName: null, alsoBranchIds: [] });

    // The team moves to the garden; the person with no branch gets one; Asha keeps her second branch.
    const moved = await ok<{ moved: number; unchanged: number }>(
      w.api.post('/api/branches/people/move', {
        userIds: [asha.id, ravi.id, lone.id],
        homeBranchId: g.b.garden.id,
      }),
    );
    expect(moved).toEqual({ moved: 3, unchanged: 0 });
    expect(await of(asha.id)).toMatchObject({ branchName: 'Garden Jaipur', alsoBranchIds: [g.b.lake.id] });
    expect((await of(lone.id)).branchId).toBe(g.b.garden.id);
    // Again changes nothing.
    expect(
      await ok(w.api.post('/api/branches/people/move', { userIds: [ravi.id], homeBranchId: g.b.garden.id })),
    ).toEqual({ moved: 0, unchanged: 1 });

    const places = await ok<{
      homeBranchId: string;
      moves: { branchId: string; fromBranchId: string | null }[];
    }>(w.api.get(`/api/branches/people/${ravi.id}`));
    expect(places.homeBranchId).toBe(g.b.garden.id);
    expect(places.moves[0]).toMatchObject({ branchId: g.b.garden.id });

    // A branch that does not exist, a stranger, and someone without the right are refused.
    expect(
      (await w.api.post('/api/branches/people/move', { userIds: [ravi.id], homeBranchId: 'nope' })).status,
    ).toBe(404);
    expect(
      (await w.api.post('/api/branches/people/move', { userIds: ['nobody'], homeBranchId: null })).status,
    ).toBe(404);
    expect(
      (await ravi.api.post('/api/branches/people/move', { userIds: [ravi.id], homeBranchId: g.b.lake.id }))
        .status,
    ).toBe(403);
  }, 30_000);
});
