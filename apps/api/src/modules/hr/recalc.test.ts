import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('recalculating a month', () => {
  it('works recorded days out again with today’s rules; HR only; not a month whose pay is closed', async () => {
    const w = await world(ctx.app);
    const asha = await w.person('Asha Late');
    await ctx.prisma.user.update({
      where: { id: asha.id },
      data: { createdAt: new Date(Date.now() - 60 * 86_400_000) },
    });
    const shift =
      (await ctx.prisma.shift.findFirst({
        where: { companyId: w.companyId, deletedAt: null, isDefault: true },
      })) ??
      (await ctx.prisma.shift.create({
        data: {
          companyId: w.companyId,
          name: 'Day',
          startMin: 11 * 60,
          endMin: 19 * 60,
          weekdays: [1, 2, 3, 4, 5, 6],
          isDefault: true,
        },
      }));
    // A working day at least three days back (so it is settled), by the shift's own weekdays.
    let date = '';
    for (let back = 3; back < 12 && !date; back++) {
      const d = new Date(Date.now() + 5.5 * 3_600_000 - back * 86_400_000);
      const weekday = ((d.getUTCDay() + 6) % 7) + 1;
      if (shift.weekdays.includes(weekday)) date = d.toISOString().slice(0, 10);
    }
    const at = (min: number) => new Date(new Date(`${date}T00:00:00+05:30`).getTime() + min * 60_000);
    // 40 minutes late, stayed 40 minutes past the end: a late mark under the corrected rule.
    await ctx.prisma.punch.createMany({
      data: [
        { companyId: w.companyId, userId: asha.id, type: 'IN', at: at(shift.startMin + 40) },
        { companyId: w.companyId, userId: asha.id, type: 'OUT', at: at(shift.endMin + 40) },
      ],
    });
    await ctx.prisma.attendanceDay.create({
      data: {
        companyId: w.companyId,
        userId: asha.id,
        date,
        status: 'HALF_DAY',
        reasons: ['Worked 7.3 h of 8 h'],
      },
    });
    const month = date.slice(0, 7);
    expect((await asha.api.post('/api/hr/attendance/recalculate', { month })).status).toBe(403);
    const done = await w.api.post('/api/hr/attendance/recalculate', { month });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ days: 1, changed: 1 });
    const day = await ctx.prisma.attendanceDay.findFirstOrThrow({ where: { userId: asha.id, date } });
    expect(day).toMatchObject({ status: 'LATE', lateMin: 40, overtimeMin: 0 });
    // Again changes nothing; a closed pay month is refused.
    expect((await w.api.post('/api/hr/attendance/recalculate', { month })).body).toEqual({
      days: 1,
      changed: 0,
    });
    await ctx.prisma.payRun.create({ data: { companyId: w.companyId, month, lines: [], totalPaise: 0n } });
    expect((await w.api.post('/api/hr/attendance/recalculate', { month })).status).toBe(409);
  }, 30_000);
});
