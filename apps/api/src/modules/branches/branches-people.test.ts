import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, daysInMonth, localDate } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { applyBranchMoves, branchHistory } from './history';
import { ok, twoOutlets, type World } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const TZ = 'Asia/Kolkata';
/** Last month (it has ended): its name and its days. */
function lastMonth() {
  const [y, m] = localDate(new Date(), TZ).split('-').map(Number) as [number, number];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const month = `${py}-${String(pm).padStart(2, '0')}`;
  const n = daysInMonth(py, pm);
  return { month, n, dates: Array.from({ length: n }, (_, i) => addDays(`${month}-01`, i)) };
}
const move = (w: World, userId: string, branchId: string | null, from?: string) =>
  ok(w.api.put(`/api/branches/people/${userId}`, { homeBranchId: branchId, alsoBranchIds: [], from }));

describe('people across branches (phase 12, stage B)', () => {
  it('G25: a move takes effect from its day; the day it comes, the home branch switches over', async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    const cook = await g.at('Cook Rooftop', g.b.rooftop.id);
    const today = localDate(new Date(), TZ);
    const on = async (date: string) =>
      (await branchHistory(ctx.prisma, w.companyId, [cook.id])).on(cook.id, date);
    const home = async () => (await ctx.prisma.user.findUniqueOrThrow({ where: { id: cook.id } })).branchId;
    // A first branch counts from the beginning.
    expect(await on('2020-01-01')).toBe(g.b.rooftop.id);
    // A move planned for next week: nothing changes today …
    const next = addDays(today, 7);
    await move(w, cook.id, g.b.lake.id, next);
    expect(await home()).toBe(g.b.rooftop.id);
    expect(await on(addDays(next, -1))).toBe(g.b.rooftop.id);
    expect(await on(next)).toBe(g.b.lake.id);
    // … and on the day, the daily job switches the home branch (once).
    expect(await applyBranchMoves(ctx.prisma, new Date(), w.companyId)).toBe(0);
    const thatDay = new Date(Date.now() + 7 * 86_400_000);
    expect(await applyBranchMoves(ctx.prisma, thatDay, w.companyId)).toBe(1);
    expect(await home()).toBe(g.b.lake.id);
    expect(await applyBranchMoves(ctx.prisma, thatDay, w.companyId)).toBe(0);
    // A move entered late, with the day it really happened, rewrites the days since.
    await move(w, cook.id, g.b.garden.id, addDays(today, -3));
    expect(await on(addDays(today, -4))).toBe(g.b.rooftop.id);
    expect(await on(addDays(today, -1))).toBe(g.b.garden.id);
    expect(await on(next)).toBe(g.b.lake.id);
    // Changing the branch on the Users screen is a move from today.
    const other = await g.at('Waiter Garden', g.b.garden.id);
    await ok(w.api.patch(`/api/org/users/${other.id}`, { branchId: g.b.kitchen.id }));
    const h = await branchHistory(ctx.prisma, w.companyId, [other.id]);
    expect([h.on(other.id, addDays(today, -1)), h.on(other.id, today)]).toEqual([
      g.b.garden.id,
      g.b.kitchen.id,
    ]);
  });

  it("G26: someone moved mid-month is paid by both branches for their own days; attendance carries the day's branch", async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    const cook = await g.at('Cook Rooftop', g.b.rooftop.id);
    const lm = lastMonth();
    await ctx.prisma.user.update({
      where: { id: cook.id },
      data: { hr: { doj: '2025-01-01', salary: 30_000 } },
    });
    await ctx.prisma.attendanceDay.createMany({
      data: lm.dates.map((date) => ({
        companyId: w.companyId,
        userId: cook.id,
        date,
        status: 'PRESENT',
        workedMin: 480,
      })),
    });
    // The cook moved to the lake on the 11th of last month.
    await move(w, cook.id, g.b.lake.id, `${lm.month}-11`);
    type Line = {
      user: { id: string };
      grossPaise: number;
      byBranch: { branchId: string | null; days: number; paise: number }[];
    };
    const pay = await ok<{ lines: Line[] }>(w.api.get(`/api/hr/payroll/${lm.month}`));
    const line = pay.lines.find((l) => l.user.id === cook.id)!;
    expect(line.byBranch.map((b) => [b.branchId, b.days])).toEqual([
      [g.b.rooftop.id, 10],
      [g.b.lake.id, lm.n - 10],
    ]);
    // The two shares add up to the gross, to the paisa, in proportion to the days.
    expect(line.byBranch[0]!.paise + line.byBranch[1]!.paise).toBe(line.grossPaise);
    expect(line.byBranch[0]!.paise).toBe(Math.round((line.grossPaise * 10) / lm.n));
    // A day settled now is stamped with the branch of that day.
    const { settleDay } = await import('../hr/attendance');
    const { hrPerson } = await import('../hr/people');
    const p = await hrPerson(ctx.prisma, w.companyId, cook.id);
    const stamp = async (date: string) => {
      await ctx.prisma.attendanceDay.deleteMany({ where: { userId: cook.id, date } });
      await settleDay(ctx.prisma, w.companyId, p, date);
      return (
        await ctx.prisma.attendanceDay.findUniqueOrThrow({
          where: { userId_date: { userId: cook.id, date } },
        })
      ).branchId;
    };
    expect(await stamp(`${lm.month}-05`)).toBe(g.b.rooftop.id);
    expect(await stamp(`${lm.month}-20`)).toBe(g.b.lake.id);
  });
  it('G27: people punch at any of their branches, and a branch may have more than one place to punch from', async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    const place = (branchId: string, lat: number, lng: number, details: object = {}) =>
      ctx.prisma.branch.update({ where: { id: branchId }, data: { lat, lng, radiusM: 150, details } });
    await place(g.b.rooftop.id, 26.9124, 75.7873, {
      fences: [{ name: 'Staff gate', lat: 26.9224, lng: 75.7873, radiusM: 100 }],
    });
    await place(g.b.garden.id, 26.85, 75.8);
    await place(g.b.lake.id, 26.4499, 74.6399);
    const floater = await g.at('Floating Chef', g.b.rooftop.id);
    await ok(
      w.api.put(`/api/branches/people/${floater.id}`, {
        homeBranchId: g.b.rooftop.id,
        alsoBranchIds: [g.b.garden.id],
      }),
    );
    const at = (lat: number, lng: number, type: 'IN' | 'OUT' = 'IN') =>
      floater.api.post('/api/hr/punch', { type, lat, lng, accuracy: 15 });
    const punched = async (lat: number, lng: number, type: 'IN' | 'OUT' = 'IN') =>
      (await ok<{ punch: { flagged: boolean; branchId: string | null } }>(at(lat, lng, type))).punch;
    // Home branch, its second gate, and the other branch they work at: no flag, each stamped with its branch.
    expect(await punched(26.9125, 75.7874)).toMatchObject({ flagged: false, branchId: g.b.rooftop.id });
    expect(await punched(26.9224, 75.7874, 'OUT')).toMatchObject({
      flagged: false,
      branchId: g.b.rooftop.id,
    });
    expect(await punched(26.8501, 75.8001)).toMatchObject({ flagged: false, branchId: g.b.garden.id });
    // A branch that isn't theirs is "away from the office", whatever geofence it has.
    const away = await at(26.4499, 74.6399, 'OUT');
    expect(away.status).toBe(400);
    expect(away.body.error.message).toMatch(/Punch not allowed/);
  });
  it('G28: a person lent to another branch for some days belongs to it then — its lists, its gate, its cost', async () => {
    const w = await world(ctx.app);
    const { g, rooftop } = await twoOutlets(ctx.prisma, w);
    const cook = await g.at('Cook Rooftop', g.b.rooftop.id);
    const today = localDate(new Date(), TZ);
    const lend = (api: World['api'], from: string, to: string, branchId = g.b.lake.id) =>
      api.post('/api/branches/loans', { userId: cook.id, branchId, from, to, note: 'Wedding at the lake' });
    // Lent to the lake from yesterday to tomorrow.
    await ok(lend(w.api, addDays(today, -1), addDays(today, 1)));
    // Not twice for the same days, and not to where they already work.
    expect((await lend(w.api, today, addDays(today, 5))).status).toBe(409);
    expect((await lend(w.api, addDays(today, 10), addDays(today, 11), g.b.rooftop.id)).status).toBe(400);
    // For those days they are part of the lake: they see its work, and the days count there.
    const { branchesOf } = await import('./reach');
    expect((await branchesOf(ctx.prisma, w.companyId, cook.id)).sort()).toEqual(
      [g.b.rooftop.id, g.b.lake.id].sort(),
    );
    const h = await branchHistory(ctx.prisma, w.companyId, [cook.id]);
    expect([-2, -1, 0, 1, 2].map((n) => h.on(cook.id, addDays(today, n)))).toEqual([
      g.b.rooftop.id,
      g.b.lake.id,
      g.b.lake.id,
      g.b.lake.id,
      g.b.rooftop.id,
    ]);
    // Their own manager may lend them; a manager of another branch may not.
    const { lake } = { lake: await g.at('Leela Other', g.b.lake.id, 'HOD') };
    expect((await lend(lake.api, addDays(today, 20), addDays(today, 21), g.b.garden.id)).status).toBe(403);
    const again = await ok<{ id: string }>(
      lend(rooftop.api, addDays(today, 20), addDays(today, 21), g.b.garden.id),
    );
    await ok(rooftop.api.del(`/api/branches/loans/${again.id}`));
    expect(await ok<unknown[]>(w.api.get('/api/branches/loans'))).toHaveLength(1);
  });

  it('G29: "Buddy from another branch: No" keeps cover suggestions inside the branch', async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    const kitchen = await ok<{ id: string }>(w.api.post('/api/org/departments', { name: 'Kitchen' }));
    const inKitchen = async (name: string, branchId: string) => {
      const p = await g.at(name, branchId);
      await ok(w.api.patch(`/api/org/users/${p.id}`, { mainDepartmentId: kitchen.id }));
      return p;
    };
    const cook = await inKitchen('Cook Rooftop', g.b.rooftop.id);
    const mate = await inKitchen('Mate Rooftop', g.b.rooftop.id);
    const far = await inKitchen('Cook Lake', g.b.lake.id);
    const day = addDays(localDate(new Date(), TZ), 3);
    await ok(
      w.api.post('/api/tasks', {
        doerId: cook.id,
        plannedAt: new Date(`${day}T06:00:00Z`).toISOString(),
        description: 'Stock take',
      }),
    );
    const suggested = async () => {
      const p = await ok<{ items: { suggestions: { id: string }[] }[] }>(
        cook.api.get(`/api/hr/leave/preview?from=${day}&to=${day}`),
      );
      return p.items.flatMap((x) => x.suggestions.map((s) => s.id));
    };
    // As before branches: anyone in the department, wherever they work.
    expect((await suggested()).sort()).toEqual([mate.id, far.id].sort());
    const rules = (await ok<{ rules: { buddy: object } }>(w.api.get('/api/hr/rules'))).rules;
    await ok(w.api.put('/api/hr/rules', { ...rules, buddy: { ...rules.buddy, otherBranch: false } }));
    expect(await suggested()).toEqual([mate.id]);
  });
});
