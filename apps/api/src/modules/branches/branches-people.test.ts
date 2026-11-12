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
});
