import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { sweepTickets } from '../ticket/jobs';
import { chainFor } from './approvals';
import { group, ok, type World } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const HOUR = 3_600_000;

/** The hotel group with a manager at the rooftop and the lake, an area manager over Jaipur, and staff. */
async function staffed(w: World) {
  const g = await group(w);
  const rooftopMgr = await g.at('Farah Rooftop', g.b.rooftop.id);
  const lakeMgr = await g.at('Leela Lake', g.b.lake.id);
  const area = await w.person('Arjun Area');
  const managers = (body: object) => ok(w.api.put('/api/branches/managers', body));
  await managers({ branchId: g.b.rooftop.id, role: 'MANAGER', userIds: [rooftopMgr.id] });
  await managers({ branchId: g.b.lake.id, role: 'MANAGER', userIds: [lakeMgr.id] });
  await managers({ regionId: g.jaipur.id, role: 'AREA', userIds: [area.id] });
  const cook = await g.at('Cook Rooftop', g.b.rooftop.id);
  const gardener = await g.at('Gita Garden', g.b.garden.id);
  const steward = await g.at('Steward Lake', g.b.lake.id);
  const route = (body: object) => w.api.put('/api/branches/approvals', body);
  return { g, rooftopMgr, lakeMgr, area, cook, gardener, steward, route };
}

describe('approval routing: the owner decides who approves (phase 12, decision 14)', () => {
  it('G9: a ladder per kind, for the group or one branch — skips, go-up after hours, amounts', async () => {
    const w = await world(ctx.app);
    const s = await staffed(w);
    const chain = (kind: 'hr.leave' | 'ims.adjustment', requesterId: string, more: object = {}, now?: Date) =>
      chainFor(ctx.prisma, w.companyId, kind, { requesterId, ...more }, now);

    // Nothing set: no route — each module keeps its own rule.
    expect(await chain('hr.leave', s.cook.id)).toBeNull();
    // Only the owner (company admin) sets routes; a route needs a step, and a named step needs its person.
    expect(
      (await s.rooftopMgr.api.put('/api/branches/approvals', { kind: 'hr.leave', steps: [{ who: 'owner' }] }))
        .status,
    ).toBe(403);
    expect((await s.route({ kind: 'hr.leave', steps: [] })).status).toBe(400);
    expect((await s.route({ kind: 'hr.leave', steps: [{ who: 'user' }] })).status).toBe(400);

    await ok(
      s.route({
        kind: 'hr.leave',
        steps: [
          { who: 'branch_manager', skipIfEmpty: true, escalateAfterHours: 4 },
          { who: 'area_manager', skipIfEmpty: true, escalateAfterHours: 4 },
          { who: 'owner' },
        ],
      }),
    );
    // The cook's leave goes to the rooftop's manager first.
    const first = await chain('hr.leave', s.cook.id);
    expect(first!.first).toEqual([s.rooftopMgr.id]);
    expect(first!.deciders).toEqual([s.rooftopMgr.id]);
    // No answer: after 4 hours the area manager may decide too, after 8 the owner.
    const asked = new Date('2030-01-07T04:00:00Z');
    const at = async (hours: number) =>
      (await chain('hr.leave', s.cook.id, { askedAt: asked }, new Date(asked.getTime() + hours * HOUR)))!
        .deciders;
    expect(await at(1)).toEqual([s.rooftopMgr.id]);
    expect(await at(5)).toEqual([s.rooftopMgr.id, s.area.id]);
    expect(await at(9)).toEqual([s.rooftopMgr.id, s.area.id, w.owner.id]);
    // The garden has no manager: passed over, straight to the area manager.
    expect((await chain('hr.leave', s.gardener.id))!.first).toEqual([s.area.id]);
    // The manager's own leave is never theirs to decide: it starts one step up.
    expect((await chain('hr.leave', s.rooftopMgr.id))!.first).toEqual([s.area.id]);
    // The lake is in Ajmer (no area manager): manager, then the owner once 4 hours have passed.
    expect((await chain('hr.leave', s.steward.id))!.steps.map((x) => x.userIds)).toEqual([
      [s.lakeMgr.id],
      [],
      [w.owner.id],
    ]);

    // One branch may have its own route; saving again replaces it; removing it puts the group's back.
    const own = await ok<{ id: string }>(
      s.route({ kind: 'hr.leave', branchId: s.g.b.lake.id, steps: [{ who: 'user', userId: s.area.id }] }),
    );
    expect((await chain('hr.leave', s.steward.id))!.first).toEqual([s.area.id]);
    expect((await chain('hr.leave', s.cook.id))!.first).toEqual([s.rooftopMgr.id]);
    expect(await ok<unknown[]>(w.api.get('/api/branches/approvals'))).toHaveLength(2);
    await ok(w.api.del(`/api/branches/approvals/${own.id}`));
    expect((await chain('hr.leave', s.steward.id))!.first).toEqual([s.lakeMgr.id]);
    // A step that waits (not "skip if empty") holds the request when nobody is there.
    await ok(
      s.route({
        kind: 'hr.leave',
        branchId: s.g.b.garden.id,
        steps: [{ who: 'branch_manager' }, { who: 'owner' }],
      }),
    );
    const waits = await chain('hr.leave', s.gardener.id);
    expect(waits!.deciders).toEqual([]);

    // Amounts: small adjustments to the manager; from ₹10,000 the area manager; from ₹1,00,000 the owner.
    await ok(
      s.route({
        kind: 'ims.adjustment',
        steps: [
          { who: 'branch_manager', skipIfEmpty: true },
          { who: 'area_manager', fromAmount: 10_000 },
          { who: 'owner', fromAmount: 100_000 },
        ],
      }),
    );
    const firstFor = async (amount: number) => (await chain('ims.adjustment', s.cook.id, { amount }))!.first;
    expect(await firstFor(5_000)).toEqual([s.rooftopMgr.id]);
    expect(await firstFor(50_000)).toEqual([s.area.id]);
    expect(await firstFor(200_000)).toEqual([w.owner.id]);
    // Every change of a route is in the audit log.
    const audits = await ctx.prisma.auditLog.count({
      where: { companyId: w.companyId, action: { startsWith: 'approval_route.' } },
    });
    expect(audits).toBe(5);
  });

  it('G10: leave, corrections, stock adjustments, slips and ticket escalation follow the route', async () => {
    const w = await world(ctx.app);
    const s = await staffed(w);
    const ladder = [{ who: 'branch_manager', skipIfEmpty: true }, { who: 'owner' }];
    for (const kind of ['hr.leave', 'hr.correction', 'ims.adjustment', 'slip', 'ticket'])
      await ok(s.route({ kind, steps: ladder }));

    // Leave: the cook's request waits on the rooftop's manager — not on the lake's, whatever their rights.
    const types = await ok<{ id: string; code: string }[]>(s.cook.api.get('/api/hr/leave/types'));
    const day = addDays(localDate(new Date(), 'Asia/Kolkata'), 10);
    const leave = await ok<{ id: string }>(
      s.cook.api.post('/api/hr/leave', {
        leaveTypeId: types.find((t) => t.code === 'LWP')!.id,
        from: day,
        to: addDays(day, 2),
        reason: 'Family function',
      }),
    );
    const row = await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
    expect(row.approverId).toBe(s.rooftopMgr.id);
    const toDecide = async (api: World['api']) =>
      (await ok<{ toDecide: { id: string }[] }>(api.get('/api/hr/leave'))).toDecide.map((l) => l.id);
    expect(await toDecide(s.rooftopMgr.api)).toEqual([leave.id]);
    expect(await toDecide(s.lakeMgr.api)).toEqual([]);
    expect((await s.lakeMgr.api.post(`/api/hr/leave/${leave.id}/decide`, { approve: true })).status).toBe(
      403,
    );
    expect((await s.cook.api.post(`/api/hr/leave/${leave.id}/decide`, { approve: true })).status).toBe(403);
    await ok(s.rooftopMgr.api.post(`/api/hr/leave/${leave.id}/decide`, { approve: true }));
    expect((await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe(
      'APPROVED',
    );
    // The request was announced to the route's first person in the HOD's place.
    const asked = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { companyId: w.companyId, name: 'hr.leave_requested' },
    });
    expect((asked.payload as { approverIds: string[] }).approverIds).toEqual([s.rooftopMgr.id]);

    // A stock adjustment: asked by the cook, decided by their manager (the owner always may).
    const item = await ok<{ id: string }>(
      w.api.post('/api/ims/items', { code: 'OIL-1', name: 'Cooking oil', unit: 'L', ratePaise: 12000 }),
    );
    await ok(w.api.post('/api/ims/moves', { itemId: item.id, type: 'IN', qty: 100 }));
    const hod = await ctx.prisma.role.findUniqueOrThrow({ where: { id: w.role('MEMBER') } });
    await ok(
      w.api.patch(`/api/org/roles/${hod.id}`, {
        permissions: [...new Set([...hod.permissions, 'ims.view', 'ims.create', 'ims.approve'])],
      }),
    );
    const adjust = await ok<{ move: { id: string }; pending: boolean }>(
      s.cook.api.post('/api/ims/moves', { itemId: item.id, type: 'ADJUST', qty: -5, reason: 'DAMAGED' }),
    );
    expect(adjust.pending).toBe(true);
    const decide = (api: World['api'], approve = true) =>
      api.post(`/api/ims/moves/${adjust.move.id}/decide`, { approve });
    expect((await decide(s.lakeMgr.api)).status).toBe(403);
    expect((await decide(s.cook.api)).status).toBe(403);
    expect((await ok<{ status: string }>(decide(s.rooftopMgr.api))).status).toBe('APPLIED');

    // A help slip: the first step screens it, the next decides.
    const slip = await ok<{ id: string }>(
      s.steward.api.post('/api/slips', {
        problem: 'Guests wait too long for the bill',
        solutions: ['A second billing counter', 'Bills at the table', 'A runner at peak hours'],
      }),
    );
    const slipRow = await ctx.prisma.slip.findUniqueOrThrow({ where: { id: slip.id } });
    expect([slipRow.receiverId, slipRow.approverId]).toEqual([s.lakeMgr.id, w.owner.id]);

    // A ticket nobody answers goes up to the manager of the ticket's branch (the raiser's).
    const ticket = await ok<{ id: string }>(
      s.cook.api.post('/api/tickets', {
        title: 'Fridge is warm',
        description: 'Cold room at 9°C',
        solverId: s.steward.id,
      }),
    );
    await sweepTickets(ctx.prisma, new Date(Date.now() + 30 * HOUR));
    const up = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { companyId: w.companyId, name: 'ticket.escalated', entityId: ticket.id },
    });
    expect((up.payload as { userId: string[] }).userId).toContain(s.rooftopMgr.id);
  });
});
