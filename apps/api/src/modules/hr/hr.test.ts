import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc } from '@mono/shared';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';
import { settleAttendance } from './attendance';
import { myMonth } from './days';
import { runCovers } from './cover';
import { watchAbsences } from './absence';
import { morningCoverReport } from './report';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const TZ = 'Asia/Kolkata';
const at = (d: string, hhmm: string) =>
  zonedToUtc(d, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;

/** Owner, a department with an HOD, and two people in it who can sign in. */
async function hrTeam() {
  const o = await ownerClient(ctx.app);
  const dept = await ctx.prisma.department.create({ data: { companyId: o.company.id, name: 'Dispatch' } });
  const make = async (name: string) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
    // Joined a month ago: days before someone joins are never marked.
    await ctx.prisma.user.update({
      where: { id: r.person.id },
      data: { mainDepartmentId: dept.id, createdAt: new Date(Date.now() - 30 * 86_400_000) },
    });
    const api = await signedIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: `${name.split(' ')[0]}12345`,
    });
    return { id: r.person.id as string, api };
  };
  const hod = await make('Mahesh Yadav');
  await ctx.prisma.department.update({ where: { id: dept.id }, data: { hodUserId: hod.id } });
  const hodRole = await ctx.prisma.role.findFirstOrThrow({ where: { companyId: o.company.id, key: 'HOD' } });
  await ctx.prisma.user.update({ where: { id: hod.id }, data: { roleId: hodRole.id } });
  const hodApi = await signedIn(
    ctx.app,
    (await ctx.prisma.user.findUniqueOrThrow({ where: { id: hod.id } })).mobile!,
    'Mahesh12345',
  );
  return {
    ...o,
    dept,
    hod: { ...hod, api: hodApi },
    asha: await make('Asha Meena'),
    ravi: await make('Ravi Kumar'),
  };
}

describe('attendance', () => {
  it('punches: geofence blocks or flags by the rules; offline punches keep their time', async () => {
    const { api, company, asha } = await hrTeam();
    if (!(await ctx.prisma.branch.count({ where: { companyId: company.id } })))
      await ctx.prisma.branch.create({
        data: { companyId: company.id, name: 'Kishangarh plant', isDefault: true },
      });
    await ctx.prisma.branch.updateMany({
      where: { companyId: company.id },
      data: { lat: 26.5917, lng: 74.8542, radiusM: 150, isDefault: true },
    });
    const near = { lat: 26.5918, lng: 74.8543, accuracy: 15 };
    const far = { lat: 26.6017, lng: 74.8542, accuracy: 15 };
    expect((await asha.api.post('/api/hr/punch', { type: 'IN', ...far })).body.error.message).toMatch(
      /Punch not allowed: .*m from the office/,
    );
    const ok = await asha.api.post('/api/hr/punch', { type: 'IN', ...near });
    expect(ok.status).toBe(200);
    expect(ok.body.punch).toMatchObject({ flagged: false });
    // Allow and flag instead: the HOD hears about it.
    const rules = (await api.get('/api/hr/rules')).body.rules;
    await api.put('/api/hr/rules', { ...rules, punches: { ...rules.punches, awayFromOffice: 'flag' } });
    const flagged = await asha.api.post('/api/hr/punch', {
      type: 'OUT',
      ...far,
      at: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(flagged.body.punch).toMatchObject({
      flagged: true,
      flagReason: expect.stringMatching(/m from the office/),
    });
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: company.id, name: 'hr.punch_flagged' } }),
    ).toBe(1);
    // Not possible: a punch two days back.
    expect(
      (
        await asha.api.post('/api/hr/punch', {
          type: 'IN',
          ...near,
          at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        })
      ).status,
    ).toBe(400);
  });

  it('settles a day two hours after the shift from the punches; corrections are limited and fix the day', async () => {
    const { company, asha, hod } = await hrTeam();
    const day = addDays(localDate(new Date(), TZ), -3);
    await ctx.prisma.punch.createMany({
      data: [
        { companyId: company.id, userId: asha.id, type: 'IN', at: at(day, '09:40') },
        { companyId: company.id, userId: asha.id, type: 'OUT', at: at(day, '19:10') },
      ],
    });
    // The default shift is 09:00–18:00 (seed) unless the company set its own; settle from the night after.
    const shift = await ctx.prisma.shift.findFirstOrThrow({
      where: { companyId: company.id, isDefault: true },
    });
    await ctx.prisma.shift.update({
      where: { id: shift.id },
      data: { startMin: 9 * 60, endMin: 18 * 60, weekdays: [1, 2, 3, 4, 5, 6, 7] },
    });
    await settleAttendance(ctx.prisma, at(addDays(day, 1), '09:00'), company.id);
    const d = await ctx.prisma.attendanceDay.findUniqueOrThrow({
      where: { userId_date: { userId: asha.id, date: day } },
    });
    expect(d).toMatchObject({ status: 'LATE', lateMin: 40, overtimeMin: 70 });

    // A forgotten punch-out the day before: half day until the HOD approves the fix.
    const before = addDays(day, -1);
    await ctx.prisma.punch.create({
      data: { companyId: company.id, userId: asha.id, type: 'IN', at: at(before, '08:58') },
    });
    await settleAttendance(ctx.prisma, at(day, '09:00'), company.id);
    expect(
      (
        await ctx.prisma.attendanceDay.findUniqueOrThrow({
          where: { userId_date: { userId: asha.id, date: before } },
        })
      ).status,
    ).toBe('HALF_DAY');
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: company.id, name: 'hr.missed_punch' } }),
    ).toBe(1);
    const fix = await asha.api.post('/api/hr/corrections', {
      date: before,
      outAt: at(before, '18:05').toISOString(),
      reason: 'Phone battery died',
    });
    expect(fix.status).toBe(200);
    expect((await asha.api.post(`/api/hr/corrections/${fix.body.id}/decide`, { approve: true })).status).toBe(
      403,
    );
    expect((await hod.api.post(`/api/hr/corrections/${fix.body.id}/decide`, { approve: true })).status).toBe(
      200,
    );
    expect(
      (
        await ctx.prisma.attendanceDay.findUniqueOrThrow({
          where: { userId_date: { userId: asha.id, date: before } },
        })
      ).status,
    ).toBe('PRESENT');
    // Three a month by default.
    for (let i = 0; i < 2; i++)
      expect(
        (
          await asha.api.post('/api/hr/corrections', {
            date: before,
            outAt: at(before, '18:00').toISOString(),
            reason: 'again',
          })
        ).status,
      ).toBe(200);
    expect(
      (
        await asha.api.post('/api/hr/corrections', {
          date: before,
          outAt: at(before, '18:00').toISOString(),
          reason: 'again',
        })
      ).body.error.message,
    ).toMatch(/Only 3 corrections a month/);
  });

  it('imports biometric punches by code (first IN, last OUT) and skips repeats and unknown codes', async () => {
    const { api, company, asha } = await hrTeam();
    const code = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: asha.id } })).code!;
    const day = addDays(localDate(new Date(), TZ), -2);
    const [y, m, d] = day.split('-');
    const csv = `code,time\n${code},${d}/${m}/${y} 09:02\n${code},${d}/${m}/${y} 13:00\n${code},${d}/${m}/${y} 18:30\nX999,${d}/${m}/${y} 09:00\n${code},31/02/2026 09:00`;
    const r = (await api.post('/api/hr/attendance/import', { csv })).body;
    expect(r).toMatchObject({ added: 2, unknownCodes: ['X999'], badLines: [6] });
    expect((await api.post('/api/hr/attendance/import', { csv })).body.added).toBe(0);
    const punches = await ctx.prisma.punch.findMany({ where: { userId: asha.id }, orderBy: { at: 'asc' } });
    expect(punches.map((p) => [p.type, p.source])).toEqual([
      ['IN', 'biometric'],
      ['OUT', 'biometric'],
    ]);
    // Members can't import.
    expect((await asha.api.post('/api/hr/attendance/import', { csv })).status).toBe(403);
    void company;
  });
});

describe('night shifts', () => {
  it("after midnight the punch card is still on last evening's shift (so the next punch is OUT)", async () => {
    const { company, asha } = await hrTeam();
    const night = await ctx.prisma.shift.create({
      data: {
        companyId: company.id,
        name: 'Night',
        startMin: 23 * 60,
        endMin: 7 * 60,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      },
    });
    await ctx.prisma.user.update({ where: { id: asha.id }, data: { shiftId: night.id } });
    const d = addDays(localDate(new Date(), TZ), -1);
    await ctx.prisma.punch.create({
      data: { companyId: company.id, userId: asha.id, type: 'IN', at: at(d, '22:55') },
    });
    const actor = {
      companyId: company.id,
      userId: asha.id,
      permissions: ['hr.view'],
      ip: null,
      userAgent: null,
    };
    const morning = at(addDays(d, 1), '06:50');
    const m = await myMonth(ctx.prisma, actor as never, d.slice(0, 7), asha.id, morning);
    expect(m.today).toMatchObject({ date: d, final: false });
    expect(m.punches.map((x) => x.type)).toEqual(['IN']);
    // The 07:05 punch-out makes last night a full day, on the date it started.
    await ctx.prisma.punch.create({
      data: { companyId: company.id, userId: asha.id, type: 'OUT', at: at(addDays(d, 1), '07:05') },
    });
    await settleAttendance(ctx.prisma, at(addDays(d, 1), '09:30'), company.id);
    expect(
      (
        await ctx.prisma.attendanceDay.findUniqueOrThrow({
          where: { userId_date: { userId: asha.id, date: d } },
        })
      ).status,
    ).toBe('PRESENT');
  });

  it('someone missing a night shift is reported absent after midnight', async () => {
    const { api, company, asha } = await hrTeam();
    const night = await ctx.prisma.shift.create({
      data: {
        companyId: company.id,
        name: 'Night',
        startMin: 23 * 60,
        endMin: 7 * 60,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      },
    });
    await ctx.prisma.user.update({ where: { id: asha.id }, data: { shiftId: night.id } });
    await api.put('/api/hr/weekly-offs', {
      days: [1, 2, 3, 4, 5, 6, 7].map((w) => ({ weekday: w, kind: 'WORKING' })),
    });
    const d = addDays(localDate(new Date(), TZ), -1);
    await ctx.prisma.punch.create({
      data: { companyId: company.id, userId: asha.id, type: 'IN', at: at(addDays(d, -1), '23:00') },
    });
    await api.post('/api/tasks', {
      doerId: asha.id,
      plannedAt: at(addDays(d, 1), '05:00').toISOString(),
      description: 'Night stock check',
    });
    // 01:45 is past 23:00 + 150 min of the shift that started the evening before.
    await watchAbsences(ctx.prisma, at(addDays(d, 1), '01:45'), company.id);
    const ev = await ctx.prisma.domainEvent.findFirst({
      where: { companyId: company.id, name: 'hr.absent_no_cover' },
    });
    expect(ev?.payload).toMatchObject({ personId: asha.id, count: 1 });
  });
});

describe('leave and Buddy rules', () => {
  it('checks balance, overlap and days off; counts only working days', async () => {
    const { api, asha } = await hrTeam();
    const types = (await asha.api.get('/api/hr/leave/types')).body as { id: string; code: string }[];
    const cl = types.find((t) => t.code === 'CL')!.id;
    const start = addDays(localDate(new Date(), TZ), 10);
    expect(
      (
        await asha.api.post('/api/hr/leave', {
          leaveTypeId: cl,
          from: start,
          to: addDays(start, 20),
          reason: 'long trip',
        })
      ).body.error.message,
    ).toMatch(/Only 8 day\(s\) of Casual leave left/);
    // A holiday inside the leave isn't counted.
    await api.post('/api/hr/holidays', { date: addDays(start, 1), name: 'Govardhan Puja' });
    await api.put('/api/hr/weekly-offs', {
      days: [1, 2, 3, 4, 5, 6, 7].map((w) => ({ weekday: w, kind: 'WORKING' })),
    });
    const preview = (await asha.api.get(`/api/hr/leave/preview?from=${start}&to=${addDays(start, 2)}`)).body;
    expect(preview).toMatchObject({ days: 2, needsBuddy: true, items: [] });
    const ok = await asha.api.post('/api/hr/leave', {
      leaveTypeId: cl,
      from: start,
      to: addDays(start, 2),
      reason: 'trip',
    });
    expect(ok.body).toMatchObject({ status: 'PENDING', days: '2' });
    expect(
      (
        await asha.api.post('/api/hr/leave', {
          leaveTypeId: cl,
          from: addDays(start, 2),
          to: addDays(start, 3),
          reason: 'again',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await asha.api.post('/api/hr/leave', {
          leaveTypeId: cl,
          from: addDays(start, 1),
          to: addDays(start, 1),
          reason: 'holiday',
        })
      ).body.error.message,
    ).toMatch(/holidays or weekly offs/);
  });

  it('"Block approval" keeps leave from being approved while work has no Buddy; cancelling gives work back', async () => {
    const { api, asha, ravi, hod, owner } = await hrTeam();
    const rules = (await api.get('/api/hr/rules')).body.rules;
    await api.put('/api/hr/rules', { ...rules, buddy: { ...rules.buddy, noBuddy: 'block' } });
    const day = addDays(localDate(new Date(), TZ), 1);
    const task = (
      await api.post('/api/tasks', {
        doerId: asha.id,
        plannedAt: at(day, '15:00').toISOString(),
        description: 'Count the stock',
      })
    ).body;
    await asha.api.post(`/api/tasks/${task.id}/actions`, { action: 'accept' });
    const cl = ((await asha.api.get('/api/hr/leave/types')).body as { id: string; code: string }[]).find(
      (t) => t.code === 'CL',
    )!.id;
    const leave = (
      await asha.api.post('/api/hr/leave', { leaveTypeId: cl, from: day, to: day, reason: 'Doctor' })
    ).body;
    expect(
      (await hod.api.post(`/api/hr/leave/${leave.id}/decide`, { approve: true })).body.error.message,
    ).toMatch(/1 piece\(s\) of work still have no Buddy/);
    // She asks Ravi afterwards; he accepts on the web; now it can be approved.
    const br = (
      await asha.api.post(`/api/hr/leave/${leave.id}/buddy`, { keys: [`task:${task.id}`], buddyId: ravi.id })
    ).body;
    expect((await asha.api.post(`/api/hr/buddy/${br.id}/answer`, { accept: true })).status).toBe(403);
    expect((await ravi.api.post(`/api/hr/buddy/${br.id}/answer`, { accept: true })).status).toBe(200);
    expect((await hod.api.post(`/api/hr/leave/${leave.id}/decide`, { approve: true })).body).toMatchObject({
      status: 'APPROVED',
      withoutCover: false,
    });
    await runCovers(ctx.prisma, at(day, '00:10'));
    expect((await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).doerId).toBe(ravi.id);
    // HR calls the leave off: the work comes back at once.
    await ctx.prisma.user.update({ where: { id: owner.id }, data: {} });
    expect((await api.post(`/api/hr/leave/${leave.id}/cancel`)).body.status).toBe('CANCELLED');
    expect(await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      doerId: asha.id,
      coveredById: null,
    });
  });

  it('autopilot: picks the Buddy and approves a short leave once covered', async () => {
    const { api, company, asha, ravi } = await hrTeam();
    const rules = (await api.get('/api/hr/rules')).body.rules;
    await api.put('/api/hr/rules', {
      ...rules,
      autopilot: { ...rules.autopilot, autoPick: true, autoApproveShort: true },
    });
    const day = addDays(localDate(new Date(), TZ), 2);
    const task = (
      await api.post('/api/tasks', {
        doerId: asha.id,
        plannedAt: at(day, '12:00').toISOString(),
        description: 'Gate pass register',
      })
    ).body;
    await asha.api.post(`/api/tasks/${task.id}/actions`, { action: 'accept' });
    const cl = ((await asha.api.get('/api/hr/leave/types')).body as { id: string; code: string }[]).find(
      (t) => t.code === 'CL',
    )!.id;
    const leave = (
      await asha.api.post('/api/hr/leave', {
        leaveTypeId: cl,
        from: day,
        to: day,
        half: 'FIRST',
        reason: 'Bank work',
      })
    ).body;
    const br = await ctx.prisma.buddyRequest.findFirstOrThrow({ where: { leaveRequestId: leave.id } });
    // The least busy colleague in Dispatch is asked by itself (the HOD is the last choice).
    expect(br.buddyId).toBe(ravi.id);
    await ravi.api.post(`/api/hr/buddy/${br.id}/answer`, { accept: true });
    expect((await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe(
      'APPROVED',
    );
    void company;
  });
});

describe('absence, cover board and the morning report', () => {
  it('someone not in by the half-day mark: the HOD is told, the board shows the work, one click covers it', async () => {
    const { api, company, asha, ravi, hod } = await hrTeam();
    const shift = await ctx.prisma.shift.findFirstOrThrow({
      where: { companyId: company.id, isDefault: true },
    });
    await ctx.prisma.shift.update({
      where: { id: shift.id },
      data: { startMin: 0, endMin: 23 * 60 + 59, weekdays: [1, 2, 3, 4, 5, 6, 7] },
    });
    const today = localDate(new Date(), TZ);
    const task = (
      await api.post('/api/tasks', {
        doerId: asha.id,
        plannedAt: at(today, '23:30').toISOString(),
        description: 'Close the day book',
      })
    ).body;
    // 03:00 is past the half-day mark (00:00 + 150 min) of a shift starting at midnight.
    // Asha punches normally (so missing a punch means absent).
    await ctx.prisma.punch.create({
      data: { companyId: company.id, userId: asha.id, type: 'IN', at: at(addDays(today, -1), '00:30') },
    });
    // 03:00: past the half-day mark (00:00 + 150 min), before the 2-hour confirm time runs out.
    const now = at(today, '03:00');
    await watchAbsences(ctx.prisma, now, company.id);
    const ev = await ctx.prisma.domainEvent.findMany({
      where: { companyId: company.id, name: 'hr.absent_no_cover' },
    });
    expect(ev.find((e) => (e.payload as { personId: string }).personId === asha.id)?.payload).toMatchObject({
      count: 1,
      skipRecipients: ['owner'],
    });
    const board = (await hod.api.get(`/api/hr/cover?date=${today}`)).body;
    const row = board.away.find((a: { person: { id: string } }) => a.person.id === asha.id);
    expect(row).toMatchObject({ reason: 'absent', items: [{ key: `task:${task.id}`, state: 'none' }] });
    expect((await asha.api.get(`/api/hr/cover?date=${today}`)).status).toBe(403);
    expect(
      (
        await hod.api.post('/api/hr/cover', {
          userId: asha.id,
          keys: [`task:${task.id}`],
          buddyId: ravi.id,
          date: today,
        })
      ).body,
    ).toEqual({ covered: 1 });
    expect(await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      doerId: ravi.id,
      coveredById: ravi.id,
    });
  });

  it('sends the 08:30 report once: everyone away and their work without a Buddy, to owner and HOD', async () => {
    const { company, asha, hod, owner } = await hrTeam();
    const today = localDate(new Date(), TZ);
    const cl = await ctx.prisma.leaveType.findFirst({ where: { companyId: company.id, code: 'CL' } });
    const type =
      cl ??
      (await ctx.prisma.leaveType.create({
        data: { companyId: company.id, code: 'CL', name: 'Casual leave', yearlyQuota: 8 },
      }));
    await ctx.prisma.leaveRequest.create({
      data: {
        companyId: company.id,
        number: 1,
        userId: asha.id,
        leaveTypeId: type.id,
        from: today,
        to: today,
        days: 1,
        reason: 'x',
        status: 'APPROVED',
      },
    });
    expect(await morningCoverReport(ctx.prisma, at(today, '08:00'), company.id)).toBe(0);
    expect(await morningCoverReport(ctx.prisma, at(today, '08:31'), company.id)).toBe(2);
    expect(await morningCoverReport(ctx.prisma, at(today, '09:00'), company.id)).toBe(0);
    const sent = await ctx.prisma.domainEvent.findMany({
      where: { companyId: company.id, name: 'hr.morning_cover_report' },
    });
    expect(sent.map((s) => (s.payload as { userId: string }).userId).sort()).toEqual(
      [hod.id, owner.id].sort(),
    );
    expect((sent[0]!.payload as { report: string }).report).toContain('Asha Meena');
  });
});
