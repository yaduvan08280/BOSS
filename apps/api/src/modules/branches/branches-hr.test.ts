import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, type HrRules } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { hrPerson, hrRulesOf, personRules } from '../hr/people';
import { world } from '../records/testkit';
import { ok, twoOutlets, type World } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const TZ = 'Asia/Kolkata';
/** A working day about ten days out (three days asked, so a weekly off in between never empties it). */
const soon = () => addDays(localDate(new Date(), TZ), 10);
const askLeave = async (api: World['api']) => {
  const types = await ok<{ id: string; code: string }[]>(api.get('/api/hr/leave/types'));
  const from = soon();
  return ok<{ id: string }>(
    api.post('/api/hr/leave', {
      leaveTypeId: types.find((t) => t.code === 'LWP')!.id,
      from,
      to: addDays(from, 2),
      reason: 'Family function',
    }),
  );
};

describe('HR per entity and branch (phase 12, stage B)', () => {
  it('G30: HR rules can differ by entity and by branch; a branch has its own HR person', async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    const atRooftop = await g.at('Cook Rooftop', g.b.rooftop.id);
    const atLake = await g.at('Cook Lake', g.b.lake.id);
    const rules = (await ok<{ rules: HrRules }>(w.api.get('/api/hr/rules'))).rules;
    await ok(
      w.api.put('/api/hr/rules', {
        ...rules,
        overrides: [
          { scope: 'entity', id: g.entity.id, late: { graceMinutes: 20 }, punches: {} },
          {
            scope: 'branch',
            id: g.b.lake.id,
            late: { graceMinutes: 30 },
            punches: { awayFromOffice: 'flag' },
          },
          { scope: 'person', id: atLake.id, late: { halfDayAfterMinutes: 200 }, punches: {} },
        ],
      }),
    );
    const saved = await hrRulesOf(ctx.prisma, w.companyId);
    const of = async (id: string) => personRules(saved, await hrPerson(ctx.prisma, w.companyId, id));
    // The entity's answer for everyone in it; the branch's on top; the person's own on top of that.
    expect((await of(atRooftop.id)).late.graceMinutes).toBe(20);
    expect(await of(atLake.id)).toMatchObject({
      late: { graceMinutes: 30, halfDayAfterMinutes: 200 },
      punches: { awayFromOffice: 'flag' },
    });
    // Everything they did not mention stays the company's.
    expect((await of(atLake.id)).late.fullDayHours).toBe(rules.late.fullDayHours);
    expect((await of(atRooftop.id)).punches.awayFromOffice).toBe(rules.punches.awayFromOffice);

    // The lake's HR person decides the lake's leave — and nobody else's.
    const lakeHr = await w.person('Hema Lake HR');
    await ok(
      w.api.put('/api/branches/managers', { branchId: g.b.lake.id, role: 'HR', userIds: [lakeHr.id] }),
    );
    const lakeLeave = await askLeave(atLake.api);
    const rooftopLeave = await askLeave(atRooftop.api);
    const waiting = (await ok<{ toDecide: { id: string }[] }>(lakeHr.api.get('/api/hr/leave'))).toDecide.map(
      (l) => l.id,
    );
    expect(waiting).toEqual([lakeLeave.id]);
    expect((await lakeHr.api.post(`/api/hr/leave/${rooftopLeave.id}/decide`, { approve: true })).status).toBe(
      403,
    );
    await ok(lakeHr.api.post(`/api/hr/leave/${lakeLeave.id}/decide`, { approve: true }));
    expect((await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: lakeLeave.id } })).status).toBe(
      'APPROVED',
    );
  });
  it('G31: pay rules and minimum wages per entity; payroll runs and closes entity by entity', async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    const ajmer = await ok<{ id: string }>(w.api.post('/api/branches/entities', { name: 'Ajmer Foods LLP' }));
    await ok(
      w.api.patch(`/api/org/branches/${g.b.lake.id}`, { name: 'Lake View Ajmer', entityId: ajmer.id }),
    );
    const [y, m] = localDate(new Date(), TZ).split('-').map(Number) as [number, number];
    const month = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
    const paid = async (name: string, branchId: string, salary: number) => {
      const p = await g.at(name, branchId);
      await ctx.prisma.user.update({ where: { id: p.id }, data: { hr: { doj: '2025-01-01', salary } } });
      await ctx.prisma.attendanceDay.createMany({
        data: Array.from({ length: 28 }, (_, i) => ({
          companyId: w.companyId,
          userId: p.id,
          date: addDays(`${month}-01`, i),
          status: 'PRESENT',
          workedMin: 480,
        })),
      });
      return p;
    };
    const jaipurCook = await paid('Cook Rooftop', g.b.rooftop.id, 30_000);
    const ajmerCook = await paid('Cook Lake', g.b.lake.id, 12_000);
    // The accountant's data: Ajmer's minimum wage, and Ajmer counts a month as 26 days.
    const rules = await ok<{ rules: object }>(w.api.get('/api/hr/pay-rules'));
    await ok(
      w.api.put('/api/hr/pay-rules', {
        ...rules.rules,
        overrides: [{ scope: 'entity', id: ajmer.id, rules: { monthDays: 'fixed', fixedDays: 26 } }],
        minimumWages: [{ entityId: ajmer.id, designationId: null, monthlyPaise: 15_000_00 }],
      }),
    );
    type Pay = {
      lines: { user: { id: string }; warnings: string[] }[];
      totalPaise: number;
      closed: object | null;
    };
    const pay = (entityId?: string) =>
      ok<Pay>(w.api.get(`/api/hr/payroll/${month}${entityId ? `?entityId=${entityId}` : ''}`));
    // Each entity's payroll holds its own people; the company view still holds everyone.
    expect((await pay(ajmer.id)).lines.map((l) => l.user.id)).toEqual([ajmerCook.id]);
    expect((await pay(g.entity.id)).lines.map((l) => l.user.id)).toContain(jaipurCook.id);
    expect((await pay(g.entity.id)).lines.map((l) => l.user.id)).not.toContain(ajmerCook.id);
    expect((await pay()).lines).toHaveLength(
      (await pay(ajmer.id)).lines.length + (await pay(g.entity.id)).lines.length,
    );
    // ₹12,000 is under Ajmer's ₹15,000: flagged. Jaipur has no table: not flagged.
    expect((await pay(ajmer.id)).lines[0]!.warnings).toContain('belowMinimum');
    expect((await pay(g.entity.id)).lines.find((l) => l.user.id === jaipurCook.id)!.warnings).not.toContain(
      'belowMinimum',
    );
    // Close Ajmer alone: Jaipur stays open; the whole company can't be closed on top of it.
    const close = (entityId?: string) =>
      w.api.post(`/api/hr/payroll/${month}/close${entityId ? `?entityId=${entityId}` : ''}`, {});
    await ok(close(ajmer.id));
    expect((await pay(ajmer.id)).closed).not.toBeNull();
    expect((await pay(g.entity.id)).closed).toBeNull();
    expect((await close()).status).toBe(409);
    expect((await close(ajmer.id)).status).toBe(409);
    await ok(close(g.entity.id));
    // Reopening one entity leaves the other closed.
    await ok(
      w.api.post(`/api/hr/payroll/${month}/reopen?entityId=${ajmer.id}`, { reason: 'Wrong attendance' }),
    );
    expect((await pay(ajmer.id)).closed).toBeNull();
    expect((await pay(g.entity.id)).closed).not.toBeNull();
  });
});
