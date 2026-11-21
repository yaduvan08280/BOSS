import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { counting, makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { reachFor } from './reach';
import { group, ok, reachOf } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/**
 * Every signed-in request works out how far the person sees. The sign-in check already reads the person in
 * one query; it now also answers "has this company a franchise?" and "does this person work anywhere but
 * their home branch?", so the usual request asks nothing more (it used to ask one to five further queries).
 */
describe('a person’s reach from what the sign-in check already knows', () => {
  it('needs no query for the usual person, and is the same reach as before', async () => {
    const w = await world(ctx.app);
    const g = await group(w);
    await reachOf(w, 'MEMBER', 'branches');
    const asha = await g.at('Asha Rooftop', g.b.rooftop.id);
    const role = await ctx.prisma.role.findUniqueOrThrow({ where: { id: w.role('MEMBER') } });
    const who = {
      companyId: w.companyId,
      userId: asha.id,
      permissions: role.permissions as string[],
      reach: role.reach,
    };
    const asked = await reachFor(ctx.prisma, who);
    const watch = counting(ctx.prisma);
    const known = await reachFor(watch.db, {
      ...who,
      known: { franchises: false, home: { branchId: g.b.rooftop.id } },
    });
    expect(watch.seen.calls).toEqual([]);
    expect(known).toEqual(asked);
    expect(known.branchIds).toEqual([g.b.rooftop.id]);
    // Somebody who also works elsewhere is not "known": their branches are read as before.
    const more = counting(ctx.prisma);
    await reachFor(more.db, { ...who, known: { franchises: false } });
    expect(more.seen.calls).toContain('userBranch.findMany');
    expect(more.seen.calls).not.toContain('legalEntity.findMany');
  });

  it('a request by a person with one branch asks about franchises and branches no more; a second branch still counts', async () => {
    const w = await world(ctx.app);
    const g = await group(w);
    await reachOf(w, 'MEMBER', 'branches');
    const asha = await g.at('Asha Rooftop', g.b.rooftop.id);
    const franchises = vi.spyOn(ctx.prisma.legalEntity, 'findMany');
    const also = vi.spyOn(ctx.prisma.userBranch, 'findMany');
    const loans = vi.spyOn(ctx.prisma.branchLoan, 'findMany');
    try {
      await ok(asha.api.get('/api/hr/leave/types'));
      expect(franchises).not.toHaveBeenCalled();
      expect(also).not.toHaveBeenCalled();
      expect(loans).not.toHaveBeenCalled();
      // With a second branch her branches are read again — and the reach includes it.
      await ok(
        w.api.put(`/api/branches/people/${asha.id}`, {
          homeBranchId: g.b.rooftop.id,
          alsoBranchIds: [g.b.lake.id],
        }),
      );
      also.mockClear();
      await ok(asha.api.get('/api/hr/leave/types'));
      expect(also).toHaveBeenCalled();
    } finally {
      franchises.mockRestore();
      also.mockRestore();
      loans.mockRestore();
    }
  });
});
