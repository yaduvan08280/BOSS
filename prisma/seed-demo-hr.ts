import type { Db } from '@mono/db';
import {
  actorFor,
  answerBuddy,
  applyLeave,
  decideLeave,
  hrPerson,
  previewLeave,
  runCovers,
  settleDay,
} from '@mono/api/services';
import { addDays, DEFAULT_HR_RULES, localDate, weekdayOf, zonedToUtc } from '@mono/shared';

/**
 * Phase 7 demo (CLAUDE.md §15): HR rules, weekly offs, a geofence on the plant, two weeks of punches
 * (a few late, a missed punch-out, an absence), a leave running today with its work covered by a Buddy,
 * a leave waiting on its Buddy, and a correction waiting for the HOD. Added once.
 */
export async function seedDemoHr(db: Db, companyId: string): Promise<boolean> {
  if (await db.hrRules.findUnique({ where: { companyId } })) return false;
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const tz = company.timezone;
  const people = await db.user.findMany({
    where: { companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, name: true },
  });
  const id = (name: string) => people.find((p) => p.name === name)?.id;

  await db.hrRules.create({
    data: {
      companyId,
      rules: {
        ...DEFAULT_HR_RULES,
        leave: { ...DEFAULT_HR_RULES.leave, hrUserId: id('Kavita Rathore') ?? null },
      },
    },
  });
  await db.weeklyOff.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      companyId,
      weekday,
      kind: weekday === 7 ? 'OFF' : 'WORKING',
    })),
  });
  // Kishangarh plant: a 300 m circle for the phone punch.
  await db.branch.updateMany({
    where: { companyId, isDefault: true },
    data: { lat: 26.5917, lng: 74.8542, radiusM: 300 },
  });

  const today = localDate(new Date(), tz);
  const at = (d: string, min: number) => zonedToUtc(d, min, tz);
  const holidays = new Set(
    (await db.holiday.findMany({ where: { companyId, deletedAt: null } })).map((h) => h.date),
  );
  const punches: { companyId: string; userId: string; type: string; at: Date; source: string }[] = [];
  for (let back = 14; back >= 1; back--) {
    const d = addDays(today, -back);
    if (weekdayOf(d) === 7 || holidays.has(d)) continue;
    people.forEach((p, i) => {
      const shiftStart = 9 * 60;
      // Mostly on time; Sandeep is late on some days; Lalit forgets to punch out once; Pooja misses a day.
      if (p.name === 'Pooja Jain' && back === 4) return;
      let inMin = shiftStart - 10 + ((i * 7 + back * 3) % 20);
      if (p.name === 'Sandeep Pal' && back % 3 === 0) inMin = shiftStart + 25 + back;
      punches.push({
        companyId,
        userId: p.id,
        type: 'IN',
        at: at(d, inMin),
        source: back % 4 ? 'app' : 'biometric',
      });
      if (p.name === 'Lalit Jangid' && back === 2) return;
      punches.push({
        companyId,
        userId: p.id,
        type: 'OUT',
        at: at(d, 19 * 60 + ((i * 11 + back) % 40)),
        source: 'app',
      });
    });
  }
  // Today: everyone has punched in (except Lalit, absent without leave, and Arjun, on leave).
  people.forEach((p, i) => {
    if (p.name === 'Lalit Jangid' || p.name === 'Arjun Rawat') return;
    const inAt = at(today, 8 * 60 + 45 + (i % 20));
    if (inAt < new Date()) punches.push({ companyId, userId: p.id, type: 'IN', at: inAt, source: 'app' });
  });
  await db.punch.createMany({ data: punches, skipDuplicates: true });
  for (const p of people)
    for (let back = 14; back >= 1; back--) {
      const d = addDays(today, -back);
      await settleDay(db, companyId, await hrPerson(db, companyId, p.id), d);
    }

  // Lalit asks to fix the day he forgot to punch out.
  const lalit = id('Lalit Jangid');
  if (lalit)
    await db.correctionRequest.create({
      data: {
        companyId,
        userId: lalit,
        date: addDays(today, -2),
        outAt: at(addDays(today, -2), 19 * 60 + 5),
        reason: 'Forgot to punch out, left with the dispatch truck',
      },
    });

  const cl = async () => (await db.leaveType.findFirstOrThrow({ where: { companyId, code: 'CL' } })).id;
  // Arjun is on leave today and tomorrow; Sunita covers his open work.
  const arjun = id('Arjun Rawat');
  const sunita = id('Sunita Bansal');
  const rohit = id('Rohit Mittal');
  if (arjun && sunita && rohit) {
    const a = (await actorFor(db, companyId, arjun))!;
    const preview = await previewLeave(db, a, { from: today, to: addDays(today, 1) });
    const leave = await applyLeave(db, a, {
      leaveTypeId: await cl(),
      from: today,
      to: addDays(today, 1),
      reason: 'Sister’s wedding in Jaipur',
      buddies: Object.fromEntries(preview.items.map((i) => [i.key, sunita])),
    });
    for (const br of await db.buddyRequest.findMany({ where: { leaveRequestId: leave.id } }))
      await answerBuddy(db, (await actorFor(db, companyId, sunita))!, br.id, true);
    await decideLeave(db, (await actorFor(db, companyId, rohit))!, leave.id, true, 'Enjoy the wedding');
    await runCovers(db);
  }
  // Pooja asks for a day next week; her Buddy hasn't answered yet.
  const pooja = id('Pooja Jain');
  const suresh = id('Suresh Agarwal');
  if (pooja && suresh) {
    let d = addDays(today, 6);
    while (weekdayOf(d) === 7 || holidays.has(d)) d = addDays(d, 1);
    const a = (await actorFor(db, companyId, pooja))!;
    const preview = await previewLeave(db, a, { from: d, to: d });
    await applyLeave(db, a, {
      leaveTypeId: await cl(),
      from: d,
      to: d,
      reason: 'Bank and property papers',
      buddies: Object.fromEntries(preview.items.map((i) => [i.key, suresh])),
    });
  }
  return true;
}
