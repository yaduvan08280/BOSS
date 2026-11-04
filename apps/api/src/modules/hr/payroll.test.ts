import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, daysInMonth, localDate, weekdayOf } from '@mono/shared';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const TZ = 'Asia/Kolkata';
const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;

/** Last month, which has ended: its days, and which are Sundays. */
function lastMonth() {
  const today = localDate(new Date(), TZ);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const month = `${py}-${String(pm).padStart(2, '0')}`;
  const n = daysInMonth(py, pm);
  const dates = Array.from({ length: n }, (_, i) => addDays(`${month}-01`, i));
  return { month, n, dates, sundays: dates.filter((d) => weekdayOf(d) === 7) };
}

/** Owner, a designation, an HOD (also the HR person) and two staff with a month of attendance. */
async function payTeam() {
  const o = await ownerClient(ctx.app);
  const companyId = o.company.id;
  await ctx.prisma.weeklyOff.deleteMany({ where: { companyId } });
  await ctx.prisma.weeklyOff.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      companyId,
      weekday,
      kind: weekday === 7 ? 'OFF' : 'WORKING',
    })),
  });
  const driver = await ctx.prisma.designation.create({ data: { companyId, name: 'Driver' } });
  const make = async (name: string, designationId: string | null = null) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
    await ctx.prisma.user.update({
      where: { id: r.person.id },
      data: { designationId, hr: { doj: '2025-01-01' } },
    });
    const api = await signedIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: `${name.split(' ')[0]}12345`,
    });
    return { id: r.person.id as string, api };
  };
  const asha = await make('Asha Meena');
  const ravi = await make('Ravi Kumar', driver.id);
  const hod = await make('Mahesh Yadav');
  const rules = (await o.api.get('/api/hr/rules')).body.rules;
  await o.api.put('/api/hr/rules', { ...rules, leave: { ...rules.leave, hrUserId: hod.id } });

  // Last month: everyone present on working days; Asha absent once and in on one Sunday.
  const lm = lastMonth();
  const absentOn = lm.dates.find((d) => weekdayOf(d) === 3)!;
  const sunday = lm.sundays[1]!;
  const rows = [asha, ravi].flatMap((p) =>
    lm.dates
      .flatMap((date) => {
        const off = weekdayOf(date) === 7;
        if (p === asha && date === absentOn)
          return [{ date, status: 'ABSENT', workedMin: 0, compOff: false }];
        if (p === asha && date === sunday)
          return [{ date, status: 'WEEKLY_OFF', workedMin: 540, compOff: true }];
        return [{ date, status: off ? 'WEEKLY_OFF' : 'PRESENT', workedMin: off ? 0 : 540, compOff: false }];
      })
      .map((d) => ({ ...d, companyId, userId: p.id })),
  );
  await ctx.prisma.attendanceDay.createMany({ data: rows });
  return { ...o, companyId, driver, asha, ravi, hod, lm, sunday };
}

const line = (body: { lines: { user: { id: string } }[] }, id: string) =>
  body.lines.find((l) => l.user.id === id) as unknown as {
    grossPaise: number;
    lines: { key: string; qty: number; amountPaise: number }[];
    counts: Record<string, number>;
  };

describe('pay from attendance', () => {
  it('only HR sees and sets pay; nobody but the owner changes their own', async () => {
    const t = await payTeam();
    expect((await t.asha.api.get(`/api/hr/payroll/${t.lm.month}`)).status).toBe(403);
    expect((await t.asha.api.get('/api/hr/terms')).status).toBe(403);
    expect((await t.asha.api.put(`/api/hr/terms/${t.asha.id}`, { ratePaise: 9_99_999_00 })).status).toBe(403);
    // The HR person sets others' pay, not their own.
    expect((await t.hod.api.put(`/api/hr/terms/${t.hod.id}`, { ratePaise: 5_000_000 })).status).toBe(403);
    expect((await t.hod.api.put(`/api/hr/terms/${t.asha.id}`, { ratePaise: 3_000_000 })).status).toBe(200);
    // Daily hours need the hours.
    const bad = await t.api.put(`/api/hr/terms/${t.ravi.id}`, { pattern: 'daily', ratePaise: 80_000 });
    expect(bad.status).toBe(400);
    const terms = (await t.api.get('/api/hr/terms')).body as { user: { id: string }; saved: boolean }[];
    expect(terms.find((x) => x.user.id === t.asha.id)).toMatchObject({
      saved: true,
      terms: { ratePaise: 3_000_000 },
    });
    expect(
      await ctx.prisma.auditLog.count({ where: { companyId: t.companyId, action: 'hr.terms_saved' } }),
    ).toBe(1);
  });

  it('monthly on calendar days, daily rate, Sunday work: comp-off or extra pay, by the rules', async () => {
    const t = await payTeam();
    await t.api.put(`/api/hr/terms/${t.asha.id}`, { payBasis: 'monthly', ratePaise: 3_000_000 });
    await t.api.put(`/api/hr/terms/${t.ravi.id}`, { payBasis: 'daily', ratePaise: 80_000 });
    const perDay = Math.round(3_000_000 / t.lm.n);
    let r = (await t.api.get(`/api/hr/payroll/${t.lm.month}`)).body;
    expect(r.closed).toBeNull();
    // The HOD has no pay set: not on the sheet.
    expect(r.lines.map((l: { user: { name: string } }) => l.user.name).sort()).toEqual([
      'Asha Meena',
      'Ravi Kumar',
    ]);
    // One absence costs one day of the month (Sundays are paid days); the Sunday worked is a comp-off.
    expect(line(r, t.asha.id).grossPaise).toBe(3_000_000 - perDay);
    expect(line(r, t.asha.id).counts).toMatchObject({ absent: 1, offDaysWorked: 1 });
    expect(line(r, t.ravi.id).grossPaise).toBe(t.lm.n * 80_000);
    expect(
      (await t.asha.api.get(`/api/hr/leave/balances?date=${localDate(new Date(), TZ)}`)).body.balances,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CO', allotted: 1 })]));

    // Extra pay for working a day off instead; drivers' Sundays aren't paid.
    const saved = await t.api.put('/api/hr/pay-rules', {
      dayOffWork: 'multiplier',
      dayOffMultiplier: 2,
      overrides: [{ scope: 'designation', id: t.driver.id, rules: { paidOffDays: false } }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.rules.overrides[0].rules).toEqual({ paidOffDays: false });
    r = (await t.api.get(`/api/hr/payroll/${t.lm.month}`)).body;
    expect(line(r, t.asha.id).grossPaise).toBe(3_000_000 - perDay + 2 * perDay);
    expect(line(r, t.ravi.id).grossPaise).toBe((t.lm.n - t.lm.sundays.length) * 80_000);
    // Paid extra, so no comp-off as well.
    expect(
      (await t.asha.api.get(`/api/hr/leave/balances?date=${localDate(new Date(), TZ)}`)).body.balances,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CO', allotted: 0 })]));
    // Overrides must name something real.
    expect(
      (await t.api.put('/api/hr/pay-rules', { overrides: [{ scope: 'person', id: 'nobody', rules: {} }] }))
        .status,
    ).toBe(400);
    // A month still to come can't be worked out.
    expect((await t.api.get('/api/hr/payroll/2099-01')).status).toBe(400);
  });

  it('leave a year: the person’s own number, else their designation’s, else the leave type’s', async () => {
    const t = await payTeam();
    const today = localDate(new Date(), TZ);
    const cl = async (api: typeof t.api) =>
      (
        (await api.get(`/api/hr/leave/balances?date=${today}`)).body.balances as {
          code: string;
          allotted: number;
        }[]
      ).find((b) => b.code === 'CL')!.allotted;
    expect(await cl(t.ravi.api)).toBe(8);
    const type = await ctx.prisma.leaveType.findFirstOrThrow({
      where: { companyId: t.companyId, code: 'CL' },
    });
    const put = await t.api.put(`/api/hr/leave-quotas/${type.id}`, {
      quotas: [
        { scope: 'designation', refId: t.driver.id, yearlyQuota: 10 },
        { scope: 'person', refId: t.asha.id, yearlyQuota: 12.5 },
      ],
    });
    expect(put.status).toBe(200);
    expect(await cl(t.ravi.api)).toBe(10);
    expect(await cl(t.asha.api)).toBe(12.5);
    expect(await cl(t.hod.api)).toBe(8);
    expect(
      (
        await t.api.put(`/api/hr/leave-quotas/${type.id}`, {
          quotas: [
            { scope: 'person', refId: t.asha.id, yearlyQuota: 1 },
            { scope: 'person', refId: t.asha.id, yearlyQuota: 2 },
          ],
        })
      ).status,
    ).toBe(400);
    expect((await t.asha.api.put(`/api/hr/leave-quotas/${type.id}`, { quotas: [] })).status).toBe(403);
  });

  it('closing a month keeps its figures; reopening needs a reason and is audited', async () => {
    const t = await payTeam();
    await t.api.put(`/api/hr/terms/${t.asha.id}`, { ratePaise: 3_000_000 });
    const before = (await t.api.post(`/api/hr/payroll/${t.lm.month}/close`, {})).body;
    expect(before.closed).toMatchObject({ by: expect.any(String) });
    expect(before.totalPaise).toBe(line(before, t.asha.id).grossPaise);
    // Attendance changes later don't move a closed month.
    await ctx.prisma.attendanceDay.updateMany({
      where: { userId: t.asha.id, status: 'ABSENT' },
      data: { status: 'PRESENT', workedMin: 540 },
    });
    expect((await t.api.get(`/api/hr/payroll/${t.lm.month}`)).body.totalPaise).toBe(before.totalPaise);
    expect((await t.api.post(`/api/hr/payroll/${t.lm.month}/close`, {})).status).toBe(409);
    expect((await t.api.post(`/api/hr/payroll/${t.lm.month}/reopen`, {})).status).toBe(400);
    const open = (
      await t.api.post(`/api/hr/payroll/${t.lm.month}/reopen`, { reason: 'Absence was a field visit' })
    ).body;
    expect(open.closed).toBeNull();
    expect(open.totalPaise).toBe(3_000_000);
    expect(
      await ctx.prisma.auditLog.count({
        where: { companyId: t.companyId, action: { in: ['hr.pay_closed', 'hr.pay_reopened'] } },
      }),
    ).toBe(2);
    // The running month can't be closed yet.
    const now = localDate(new Date(), TZ).slice(0, 7);
    expect((await t.api.post(`/api/hr/payroll/${now}/close`, {})).status).toBe(400);
  });
});
