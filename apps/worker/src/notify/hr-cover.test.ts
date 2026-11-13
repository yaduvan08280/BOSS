import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@mono/db';
import {
  actOnTask,
  actorFor,
  applyLeave,
  bootstrapCompany,
  createTask,
  previewLeave,
  runCovers,
} from '@mono/api/services';
import { addDays, localDate, zonedToUtc } from '@mono/shared';
import { onAction } from './bot-handlers';
import { notifyForEvent } from './engine';

const db = createPrisma();
afterAll(async () => db.$disconnect());
const TZ = 'Asia/Kolkata';
const deps = { db, appName: 'MONO', baseUrl: 'https://mono.example.in' };

/**
 * PROMPTS.md phase 7 acceptance: a user applies for leave with open work, a Buddy is asked on Telegram and
 * accepts, the tasks show "Covered by", and after the leave ends the work not started goes back.
 */
describe('leave with a Buddy, end to end', () => {
  it('asks the Buddy on Telegram, covers the work during the leave, gives back what was not started', async () => {
    const tag = `${Date.now() % 1_000_000}`;
    const { company, owner } = await bootstrapCompany(db, {
      companyName: `HR Cover ${tag}`,
      ownerName: 'Owner',
      ownerEmail: `hr${tag}@x.in`,
      ownerPassword: 'Secret123',
    });
    const roles = Object.fromEntries(
      (await db.role.findMany({ where: { companyId: company.id } })).map((r) => [r.key, r.id]),
    );
    const dept = await db.department.create({ data: { companyId: company.id, name: 'Dispatch' } });
    const person = (code: string, name: string, role: string, chat: string) =>
      db.user.create({
        data: {
          companyId: company.id,
          code: `${code}-${tag}`,
          name,
          roleId: roles[role]!,
          mainDepartmentId: dept.id,
          telegramChatId: `${chat}${tag}`,
        },
      });
    const hod = await person('H', 'Mahesh Yadav', 'HOD', 'h');
    const asha = await person('A', 'Asha Meena', 'MEMBER', 'a');
    const ravi = await person('R', 'Ravi Kumar', 'MEMBER', 'r');
    await db.department.update({ where: { id: dept.id }, data: { hodUserId: hod.id } });
    const scope = { companyIds: [company.id] };

    // Asha has two tasks due during her leave tomorrow.
    const today = localDate(new Date(), TZ);
    // Tomorrow, or the day after when tomorrow is a Sunday (the weekly off: a leave there is 0 days).
    const next = addDays(today, 1);
    const leaveDay = new Date(`${next}T00:00:00Z`).getUTCDay() === 0 ? addDays(next, 1) : next;
    const at = (d: string, hhmm: string) =>
      zonedToUtc(d, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
    const ownerActor = (await actorFor(db, company.id, owner!.id))!;
    const give = (description: string) =>
      db.$transaction((tx) =>
        createTask(tx, ownerActor, {
          doerId: asha.id,
          plannedAt: at(leaveDay, '16:00').toISOString(),
          description,
          requireProof: false,
        }),
      );
    const t1 = await give('Load the Sharma Builders truck');
    const t2 = await give('Send the e-way bill to accounts');
    const ashaActor = (await actorFor(db, company.id, asha.id))!;
    await actOnTask(db, ashaActor, t1.id, { action: 'accept' });
    await actOnTask(db, ashaActor, t2.id, { action: 'accept' });

    // She asks for the day off; both tasks need cover and Ravi (same department) is suggested.
    const preview = await previewLeave(db, ashaActor, { from: leaveDay, to: leaveDay });
    expect(preview).toMatchObject({ days: 1, needsBuddy: true });
    expect(preview.items.map((i) => i.key).sort()).toEqual([`task:${t1.id}`, `task:${t2.id}`].sort());
    expect(preview.items[0]!.suggestions.map((s) => s.id)).toContain(ravi.id);
    const cl = await db.leaveType.findFirstOrThrow({ where: { companyId: company.id, code: 'CL' } });
    const leave = await applyLeave(db, ashaActor, {
      leaveTypeId: cl.id,
      from: leaveDay,
      to: leaveDay,
      reason: 'Family function in Ajmer',
      buddies: { [`task:${t1.id}`]: ravi.id, [`task:${t2.id}`]: ravi.id },
    });

    // Ravi is asked on Telegram, with the buttons only for him.
    const asked = await db.domainEvent.findFirstOrThrow({
      where: { companyId: company.id, name: 'hr.buddy_requested' },
    });
    await notifyForEvent(asked, deps);
    const tg = await db.outbox.findFirstOrThrow({
      where: { eventId: asked.id, channel: 'telegram', userId: ravi.id },
    });
    // Read, not sent: keep the shared outbox clear for the sender test running alongside.
    await db.outbox.updateMany({
      where: { eventId: asked.id, status: 'QUEUED' },
      data: { status: 'SKIPPED' },
    });
    const msg = tg.payload as { text: string; buttons: { label: string; data?: string }[] };
    expect(msg.text).toContain('Asha Meena');
    expect(msg.buttons.map((b) => b.label)).toEqual(expect.arrayContaining(['Yes, I will cover', "Can't"]));
    const yes = msg.buttons.find((b) => b.label === 'Yes, I will cover')!.data!;
    expect(await onAction(db, scope, `a${tag}`, yes)).toMatch(/isn't yours|not yours/i);
    expect(await onAction(db, scope, `r${tag}`, yes)).toContain('Thank you');

    // The HOD approves from Telegram too.
    const req = await db.domainEvent.findFirstOrThrow({
      where: { companyId: company.id, name: 'hr.leave_requested' },
    });
    await notifyForEvent(req, deps);
    const hodMsg = await db.outbox.findFirstOrThrow({
      where: { eventId: req.id, channel: 'telegram', userId: hod.id },
    });
    await db.outbox.updateMany({ where: { eventId: req.id, status: 'QUEUED' }, data: { status: 'SKIPPED' } });
    const approveBtn = (hodMsg.payload as { buttons: { label: string; data?: string }[] }).buttons.find(
      (b) => b.label === 'Approve',
    )!;
    expect(await onAction(db, scope, `h${tag}`, approveBtn.data!)).toContain('Leave approved');
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe('APPROVED');

    // The leave starts: Ravi has both tasks, shown "Covered by Ravi".
    await runCovers(db, at(leaveDay, '00:05'));
    for (const t of [t1, t2])
      expect(await db.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
        doerId: ravi.id,
        coveredById: ravi.id,
      });

    // Ravi starts one of them.
    const raviActor = (await actorFor(db, company.id, ravi.id))!;
    await actOnTask(db, raviActor, t1.id, { action: 'addNote', note: 'Truck booked, loading at 4' });

    // Asha is back: the task Ravi never touched goes back to her; the one he started stays his.
    await runCovers(db, at(addDays(leaveDay, 1), '00:05'));
    expect(await db.task.findUniqueOrThrow({ where: { id: t2.id } })).toMatchObject({
      doerId: asha.id,
      coveredById: null,
    });
    expect(await db.task.findUniqueOrThrow({ where: { id: t1.id } })).toMatchObject({
      doerId: ravi.id,
      coveredById: ravi.id,
    });
    const covers = await db.cover.findMany({ where: { leaveRequestId: leave.id } });
    expect(covers.map((c) => c.status)).toEqual(['RETURNED', 'RETURNED']);
    // The balance counts the day.
    const bal = await db.leaveBalance.findFirstOrThrow({ where: { userId: asha.id, leaveTypeId: cl.id } });
    expect(Number(bal.used)).toBe(1);
  });
});
