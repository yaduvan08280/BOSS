import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc } from '@mono/shared';
import { counting, makeApp, ownerClient } from '../../test/helpers';
import { watchAbsences } from './absence';
import { settleAttendance } from './attendance';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const TZ = 'Asia/Kolkata';

/**
 * The HR sweeps run every five minutes and go through everybody. On a company of 2,200 people they asked
 * four questions a person on every pass and worked every person's day out to learn it could not be kept yet:
 * 37 s of processor time a pass, which showed as slower bills at the tills. What a pass asks the database
 * must not grow with the number of people while there is nothing to do.
 */
describe('HR sweeps do not ask the database about each person in turn', () => {
  const add = async (o: Awaited<ReturnType<typeof ownerClient>>, n: number) => {
    for (let i = 0; i < n; i++)
      expect((await o.api.post('/api/org/users', { name: `Sweep Person ${i}`, mobile: rnd() })).status).toBe(
        200,
      );
  };

  it('settling: nothing is read for a day that cannot be kept yet; a kept day is not worked out again', async () => {
    const o = await ownerClient(ctx.app);
    const id = o.company.id;
    const today = localDate(new Date(), TZ);
    // Noon today: nobody's shift ended two hours ago, and nobody was here yesterday.
    const noon = zonedToUtc(today, 12 * 60, TZ);
    await add(o, 3);
    const few = counting(ctx.prisma);
    expect(await settleAttendance(few.db, noon, id)).toBe(0);
    await add(o, 5);
    const more = counting(ctx.prisma);
    expect(await settleAttendance(more.db, noon, id)).toBe(0);
    expect(more.seen.calls).toEqual(few.seen.calls);
    expect(more.seen.calls.length).toBeLessThan(12);
    expect(more.seen.calls.filter((c) => /^(punch|leaveRequest|holiday)\./.test(c))).toEqual([]);

    // Late in the evening every person's day is kept — once.
    const night = zonedToUtc(today, 23 * 60 + 30, TZ);
    const people = await ctx.prisma.user.count({
      where: { companyId: id, deletedAt: null, status: 'ACTIVE' },
    });
    expect(await settleAttendance(ctx.prisma, night, id)).toBe(people);
    expect(await ctx.prisma.attendanceDay.count({ where: { companyId: id, date: today } })).toBe(people);
    const after = counting(ctx.prisma);
    expect(await settleAttendance(after.db, night, id)).toBe(0);
    expect(after.seen.calls).toEqual(few.seen.calls);

    // Tomorrow morning: yesterday is kept, today cannot be yet — again nothing per person.
    const next = counting(ctx.prisma);
    expect(await settleAttendance(next.db, zonedToUtc(addDays(today, 1), 10 * 60, TZ), id)).toBe(0);
    expect(next.seen.calls).toEqual(few.seen.calls);
  });

  it('the absence watch reads people and calendars once a pass, whatever the head count', async () => {
    const o = await ownerClient(ctx.app);
    const id = o.company.id;
    // Three in the morning: no shift has reached its half-day mark, so nobody can be absent yet.
    const early = zonedToUtc(localDate(new Date(), TZ), 3 * 60, TZ);
    await add(o, 3);
    const few = counting(ctx.prisma);
    expect(await watchAbsences(few.db, early, id)).toBe(0);
    await add(o, 5);
    const more = counting(ctx.prisma);
    expect(await watchAbsences(more.db, early, id)).toBe(0);
    expect(more.seen.calls).toEqual(few.seen.calls);
    expect(more.seen.calls.length).toBeLessThan(20);
  });
});
