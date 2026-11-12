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
  it('G32: holidays for a country, a state, an entity or one branch; leave days a year per entity', async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    const dubai = await ok<{ id: string }>(
      w.api.post('/api/branches/entities', { name: 'GGM Gulf LLC', country: 'AE', currency: 'AED' }),
    );
    const marina = await ok<{ id: string }>(
      w.api.post('/api/org/branches', { name: 'Marina Dubai', type: 'OUTLET', entityId: dubai.id }),
    );
    await ok(
      w.api.patch(`/api/org/branches/${g.b.rooftop.id}`, { name: 'Rooftop Jaipur', state: 'Rajasthan' }),
    );
    const holiday = (date: string, name: string, more: object = {}) =>
      ok(w.api.post('/api/hr/holidays', { date, name, ...more }));
    await holiday('2031-01-01', 'New Year');
    await holiday('2031-01-26', 'Republic Day', { country: 'IN', type: 'NATIONAL' });
    await holiday('2031-12-02', 'UAE National Day', { country: 'AE', type: 'NATIONAL' });
    await holiday('2031-03-30', 'Rajasthan Day', { state: 'Rajasthan' });
    await holiday('2031-05-05', 'GGM Hotels founders day', { entityId: g.entity.id });
    await holiday('2031-06-06', 'Lake fair', { branchId: g.b.lake.id });
    const { companyCalendar } = await import('../hr/calendar');
    const days = async (branchId: string | null) =>
      [...(await companyCalendar(ctx.prisma, w.companyId, branchId)).holidays]
        .filter((d) => d.startsWith('2031'))
        .sort();
    // Rooftop (India, Rajasthan, GGM Hotels): everyone's, India's, Rajasthan's and its entity's.
    expect(await days(g.b.rooftop.id)).toEqual(['2031-01-01', '2031-01-26', '2031-03-30', '2031-05-05']);
    // The lake (same entity; the entity's state is Rajasthan): the same, plus its own fair.
    expect(await days(g.b.lake.id)).toEqual([
      '2031-01-01',
      '2031-01-26',
      '2031-03-30',
      '2031-05-05',
      '2031-06-06',
    ]);
    // Dubai: everyone's and the UAE's — not India's.
    expect(await days(marina.id)).toEqual(['2031-01-01', '2031-12-02']);
    // Someone with no branch: only what is everyone's.
    expect(await days(null)).toEqual(['2031-01-01']);

    // Leave a year: Dubai gives 30 days of EL where the company gives its own number.
    const gulfCook = await g.at('Cook Marina', marina.id);
    const jaipurCook = await g.at('Cook Rooftop', g.b.rooftop.id);
    const types = await ok<{ id: string; code: string; yearlyQuota: number }[]>(
      w.api.get('/api/hr/leave/types'),
    );
    const el = types.find((t) => t.code === 'EL')!;
    await ok(
      w.api.put(`/api/hr/leave-quotas/${el.id}`, {
        quotas: [{ scope: 'entity', refId: dubai.id, yearlyQuota: 30 }],
      }),
    );
    const { balancesOf } = await import('../hr/balance');
    const quota = async (userId: string) =>
      (await balancesOf(ctx.prisma, w.companyId, userId, localDate(new Date(), TZ))).balances.find(
        (b) => b.code === 'EL',
      )!.allotted;
    expect(await quota(gulfCook.id)).toBe(30);
    expect(await quota(jaipurCook.id)).toBe(Number(el.yearlyQuota));
  });
  it("G33: the cover board and the morning report are per branch, for that branch's manager and HR person", async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    const today = localDate(new Date(), TZ);
    const rooftopMgr = await w.person('Mira Rooftop Manager');
    const lakeHr = await w.person('Hema Lake HR');
    await ok(
      w.api.put('/api/branches/managers', {
        branchId: g.b.rooftop.id,
        role: 'MANAGER',
        userIds: [rooftopMgr.id],
      }),
    );
    await ok(
      w.api.put('/api/branches/managers', { branchId: g.b.lake.id, role: 'HR', userIds: [lakeHr.id] }),
    );
    const cookRooftop = await g.at('Cook Rooftop', g.b.rooftop.id);
    const cookLake = await g.at('Cook Lake', g.b.lake.id);
    const type = await ctx.prisma.leaveType.create({
      data: { companyId: w.companyId, code: 'XL', name: 'Extra leave', yearlyQuota: 8 },
    });
    let n = 0;
    for (const userId of [cookRooftop.id, cookLake.id])
      await ctx.prisma.leaveRequest.create({
        data: {
          companyId: w.companyId,
          number: ++n,
          userId,
          leaveTypeId: type.id,
          from: today,
          to: today,
          days: 1,
          reason: 'x',
          status: 'APPROVED',
        },
      });
    // The board: each sees their own branch; the owner both — or one, with the switcher.
    const board = async (api: World['api'], only?: string) =>
      (
        await ok<{ away: { person: { name: string } }[] }>(
          api.get(`/api/hr/cover?date=${today}`, only ? { 'x-mono-branch': only } : undefined),
        )
      ).away
        .map((a) => a.person.name)
        .sort();
    expect(await board(rooftopMgr.api)).toEqual(['Cook Rooftop']);
    expect(await board(lakeHr.api)).toEqual(['Cook Lake']);
    expect(await board(w.api)).toEqual(['Cook Lake', 'Cook Rooftop']);
    expect(await board(w.api, g.b.lake.id)).toEqual(['Cook Lake']);

    // The morning report: the owner gets everyone; each branch's manager / HR person only their own branch.
    const { morningCoverReport } = await import('../hr/report');
    const { zonedToUtc } = await import('@mono/shared');
    await morningCoverReport(ctx.prisma, zonedToUtc(today, 9 * 60, TZ), w.companyId);
    const sent = await ctx.prisma.domainEvent.findMany({
      where: { companyId: w.companyId, name: 'hr.morning_cover_report' },
    });
    const reportOf = (userId: string) =>
      (
        sent.find((e) => (e.payload as { userId: string }).userId === userId)?.payload as
          { report: string } | undefined
      )?.report ?? '';
    expect(reportOf(w.owner.id)).toMatch(/Cook Rooftop[\s\S]*Cook Lake|Cook Lake[\s\S]*Cook Rooftop/);
    expect(reportOf(rooftopMgr.id)).toContain('Cook Rooftop');
    expect(reportOf(rooftopMgr.id)).not.toContain('Cook Lake');
    expect(reportOf(lakeHr.id)).toContain('Cook Lake');
    expect(reportOf(lakeHr.id)).not.toContain('Cook Rooftop');
    // The absence alert's built-in rule now names the branch's manager and HR person.
    const rule = await ctx.prisma.notificationRule.findFirstOrThrow({
      where: { companyId: w.companyId, event: 'hr.absent_no_cover' },
    });
    expect(rule.recipients).toEqual(['hod', 'branch_manager', 'branch_hr', 'owner']);
  });
});
