import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, weekdayOf, zonedToUtc } from '@mono/shared';
import { settleDay } from './attendance';
import { hrPerson } from './people';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const TZ = 'Asia/Kolkata';
const at = (d: string, hhmm: string) =>
  zonedToUtc(d, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;

type Cell = { date: string; code: string; status: string | null; inAt: string | null; punches: unknown[] };
type Person = {
  name: string;
  cells: Cell[];
  totals: {
    present: number;
    late: number;
    absent: number;
    leave: number;
    weeklyOffs: number;
    holidays: number;
  };
};

describe('monthly muster and punch report', () => {
  it('codes each day from settled days, the calendar and leave; HR sees all, others themselves; downloads work', async () => {
    const o = await ownerClient(ctx.app);
    const companyId = o.company.id;
    const person = async (name: string) => {
      const mobile = rnd();
      const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
      // Joined well before October 2026.
      await ctx.prisma.user.update({
        where: { id: r.person.id },
        data: { code: name.slice(0, 3).toUpperCase(), createdAt: new Date('2026-09-01T06:00:00Z') },
      });
      const api = await signedIn(ctx.app, mobile, r.tempPassword);
      await api.post('/api/auth/change-password', {
        currentPassword: r.tempPassword,
        newPassword: 'Muster12345',
      });
      return { id: r.person.id as string, api };
    };
    const asha = await person('Asha Meena');
    const ravi = await person('Ravi Kumar');
    expect(
      (await o.api.post('/api/hr/holidays', { date: '2026-10-02', name: 'Gandhi Jayanti' })).status,
    ).toBe(200);
    const cl = await ctx.prisma.leaveType.create({
      data: { companyId, code: 'CL', name: 'Casual leave', yearlyQuota: 8 },
    });
    await ctx.prisma.leaveRequest.create({
      data: {
        companyId,
        number: 1,
        userId: asha.id,
        leaveTypeId: cl.id,
        from: '2026-10-08',
        to: '2026-10-09',
        days: 2,
        reason: 'Family',
        status: 'APPROVED',
      },
    });
    const day = (date: string, status: string, more: object = {}) =>
      ctx.prisma.attendanceDay.create({ data: { companyId, userId: asha.id, date, status, ...more } });
    await day('2026-10-05', 'PRESENT', {
      inAt: at('2026-10-05', '09:02'),
      outAt: at('2026-10-05', '19:05'),
      workedMin: 603,
    });
    await day('2026-10-06', 'LATE', {
      inAt: at('2026-10-06', '09:40'),
      outAt: at('2026-10-06', '19:00'),
      lateMin: 40,
      workedMin: 560,
    });
    await day('2026-10-07', 'ABSENT');
    await ctx.prisma.punch.createMany({
      data: [
        { companyId, userId: asha.id, type: 'IN', at: at('2026-10-05', '09:02') },
        { companyId, userId: asha.id, type: 'OUT', at: at('2026-10-05', '19:05'), source: 'biometric' },
      ],
    });

    const r = await o.api.get('/api/hr/attendance/muster?month=2026-10');
    expect(r.status).toBe(200);
    expect(r.body.days).toHaveLength(31);
    const a = (r.body.people as Person[]).find((p) => p.name === 'Asha Meena')!;
    const code = (d: string) => a.cells.find((c) => c.date === `2026-10-${d}`)!.code;
    // Holiday and Sunday from the calendar, the settled days, leave by its type, and no record on a working day.
    expect([
      code('02'),
      code('03'),
      code('04'),
      code('05'),
      code('06'),
      code('07'),
      code('08'),
      code('09'),
    ]).toEqual(['H', '–', 'WO', 'P', 'LT', 'A', 'CL', 'CL']);
    expect(a.totals).toMatchObject({ present: 2, late: 1, absent: 1, leave: 2, weeklyOffs: 4, holidays: 1 });
    expect(a.cells.find((c) => c.date === '2026-10-05')!.punches).toHaveLength(2);

    // Ravi (a member) sees only himself; the owner sees both.
    expect((r.body.people as Person[]).map((p) => p.name)).toEqual(
      expect.arrayContaining(['Asha Meena', 'Ravi Kumar']),
    );
    const own = await ravi.api.get('/api/hr/attendance/muster?month=2026-10');
    expect((own.body.people as Person[]).map((p) => p.name)).toEqual(['Ravi Kumar']);

    // Downloads: the muster in Excel and PDF, the daily punches in CSV with Asha's day on it.
    const xlsx = await o.api.raw('/api/hr/attendance/muster/export?month=2026-10&kind=muster&format=xlsx');
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toContain('muster-2026-10.xlsx');
    const pdf = await o.api.raw('/api/hr/attendance/muster/export?month=2026-10&format=pdf');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const csv = await o.api.raw('/api/hr/attendance/muster/export?month=2026-10&kind=punches&format=csv');
    expect(csv.body).toContain('Asha Meena');
    expect(csv.body).toMatch(/"05\/10\/2026","Mo","ASH","Asha Meena",.*,"P","09:02","19:05","10:03"/);
    expect(csv.body).toContain('19:05 OUT [biometric]');
  });

  it('a leave approved after its day was settled turns "absent" into "on leave" (off sick Monday, asked Tuesday)', async () => {
    const o = await ownerClient(ctx.app);
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name: 'Kiran Sick', mobile, loginEnabled: true })).body;
    await ctx.prisma.user.update({
      where: { id: r.person.id },
      data: { createdAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    const kiran = await signedIn(ctx.app, mobile, r.tempPassword);
    await kiran.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: 'Kiran12345',
    });
    // A working weekday a week ago (the default shift works Monday to Saturday).
    let day = addDays(localDate(new Date(), TZ), -7);
    while (weekdayOf(day) === 7) day = addDays(day, -1);
    const p = await hrPerson(ctx.prisma, o.company.id, r.person.id);
    await settleDay(ctx.prisma, o.company.id, p, day);
    const row = () =>
      ctx.prisma.attendanceDay.findUniqueOrThrow({ where: { userId_date: { userId: p.id, date: day } } });
    expect((await row()).status).toBe('ABSENT');
    const types = (await kiran.get('/api/hr/leave/types')).body as { id: string; code: string }[];
    const sl = (types.find((t) => t.code === 'SL') ?? types[0])!;
    const asked = await kiran.post('/api/hr/leave', {
      leaveTypeId: sl.id,
      from: day,
      to: day,
      reason: 'Fever',
    });
    expect(asked.status).toBe(200);
    expect((await o.api.post(`/api/hr/leave/${asked.body.id}/decide`, { approve: true })).status).toBe(200);
    expect((await row()).status).toBe('ON_LEAVE');
  });
});
