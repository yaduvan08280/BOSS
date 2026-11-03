import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc } from '@mono/shared';
import { makeApp, ownerClient, signedIn } from '../test/helpers';
import { buildBrief } from './ea/brief';
import { eaJobs } from './ea/jobs';
import { sendWeeklyMis } from './mis/jobs';
import { misFor, misPdf } from './mis/service';
import { sweepSlips } from './slip/jobs';
import { sweepTickets } from './ticket/jobs';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const TZ = 'Asia/Kolkata';

/** Owner + three members who can log in. */
async function team() {
  const o = await ownerClient(ctx.app);
  const make = async (name: string) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
    const api = await signedIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: 'Secret12345',
    });
    return { id: r.person.id as string, api };
  };
  return {
    ...o,
    sandeep: await make('Sandeep Pal'),
    ajay: await make('Ajay Meena'),
    other: await make('Other One'),
  };
}

const events = (companyId: string, prefix: string) =>
  ctx.prisma.domainEvent
    .findMany({ where: { companyId, name: { startsWith: prefix } }, orderBy: { occurredAt: 'asc' } })
    .then((e) => e.map((x) => x.name));

describe('help slips', () => {
  it('raise → return → resubmit → forward → approve (task) → close', async () => {
    const { api, company, owner, sandeep, ajay, other } = await team();
    expect(
      (await api.put('/api/work/settings/slip', { receiverUserId: ajay.id, solutionsRequired: 2 })).status,
    ).toBe(200);
    const one = await sandeep.api.post('/api/slips', {
      problem: 'Forklift battery dies by noon',
      solutions: ['Buy a new one'],
    });
    expect(one.body.error.message).toMatch(/at least 2 solutions/);
    const slip = (
      await sandeep.api.post('/api/slips', {
        problem: 'Forklift battery dies by noon',
        solutions: ['Buy a new battery', 'Charge it at lunch'],
      })
    ).body;
    expect(slip).toMatchObject({
      status: 'SUBMITTED',
      receiverId: ajay.id,
      approverId: owner.id,
      accountableId: sandeep.id,
    });
    expect((await other.api.get(`/api/slips/${slip.id}`)).status).toBe(404);
    expect(
      (await ajay.api.get('/api/slips?tab=inbox')).body.slips.map((s: { id: string }) => s.id),
    ).toContain(slip.id);

    const act = (who: typeof api, body: object) => who.post(`/api/slips/${slip.id}/actions`, body);
    expect((await act(ajay.api, { action: 'return', comment: 'Which forklift?' })).body.status).toBe(
      'RETURNED',
    );
    expect(
      (await act(sandeep.api, { action: 'resubmit', problem: 'Forklift 2 battery dies by noon' })).body
        .status,
    ).toBe('SUBMITTED');
    expect(
      (
        await act(ajay.api, {
          action: 'approve',
          ownSolution: 'Buy one',
          doerId: sandeep.id,
          plannedAt: inHours(4),
        })
      ).body.error.code,
    ).toBe('GUARD_FAILED');
    expect((await act(ajay.api, { action: 'forward' })).body.status).toBe('WITH_APPROVER');

    const detail = (await api.get(`/api/slips/${slip.id}`)).body;
    expect(detail.actions.sort()).toEqual(['approve', 'reject', 'withdraw']); // the owner is also an admin
    const approved = (
      await act(api, {
        action: 'approve',
        solutionId: detail.solutions[1].id,
        doerId: sandeep.id,
        plannedAt: inHours(4),
      })
    ).body;
    expect(approved.status).toBe('APPROVED');
    const task = await ctx.prisma.task.findUniqueOrThrow({ where: { id: approved.taskId } });
    expect(task).toMatchObject({
      source: 'slip',
      sourceId: slip.id,
      doerId: sandeep.id,
      description: 'Help slip #1: Charge it at lunch',
    });

    expect((await act(sandeep.api, { action: 'close' })).body.status).toBe('CLOSED');
    expect(await events(company.id, 'slip.')).toEqual([
      'slip.submitted',
      'slip.returned',
      'slip.submitted',
      'slip.forwarded',
      'slip.decided',
      'slip.closed',
    ]);
  });

  it('with the approver step off the receiver decides; late slips are chased once', async () => {
    const { api, company, sandeep, ajay } = await team();
    await api.put('/api/work/settings/slip', {
      receiverUserId: ajay.id,
      approverStep: false,
      solutionsRequired: 1,
    });
    const slip = (
      await sandeep.api.post('/api/slips', {
        problem: 'No drinking water on floor 2',
        solutions: ['Add a cooler'],
      })
    ).body;
    expect((await ajay.api.get(`/api/slips/${slip.id}`)).body.actions.sort()).toEqual([
      'approve',
      'reject',
      'return',
    ]);

    await ctx.prisma.slip.update({
      where: { id: slip.id },
      data: { stepSince: new Date(Date.now() - 30 * 3600_000) },
    });
    await sweepSlips(ctx.prisma);
    await sweepSlips(ctx.prisma);
    const late = await ctx.prisma.domainEvent.findMany({
      where: { companyId: company.id, name: 'slip.late' },
    });
    expect(late).toHaveLength(1);
    expect(late[0]!.payload).toMatchObject({ userId: ajay.id, accountableId: sandeep.id });

    const rejected = (
      await ajay.api.post(`/api/slips/${slip.id}/actions`, { action: 'reject', reason: 'Already ordered' })
    ).body;
    expect(rejected.status).toBe('REJECTED');
    // The raiser never closes it: closed automatically after the raiser's time limit.
    await ctx.prisma.slip.update({
      where: { id: slip.id },
      data: { stepSince: new Date(Date.now() - 49 * 3600_000) },
    });
    await sweepSlips(ctx.prisma);
    expect((await ctx.prisma.slip.findUniqueOrThrow({ where: { id: slip.id } })).status).toBe('CLOSED');
  });
});

describe('help tickets', () => {
  it('reply → resolve with proof → reopen → resolve → confirm', async () => {
    const { company, sandeep, ajay } = await team();
    const t = (await sandeep.api.post('/api/tickets', { title: 'Printer jams on A3', solverId: ajay.id }))
      .body;
    expect(t).toMatchObject({ status: 'OPEN', number: 1 });
    const act = (who: typeof sandeep.api, body: object) => who.post(`/api/tickets/${t.id}/actions`, body);
    expect((await act(ajay.api, { action: 'reply', text: 'Looking at it after lunch' })).body.status).toBe(
      'IN_PROGRESS',
    );
    expect((await act(ajay.api, { action: 'resolve', note: 'Cleaned rollers' })).body.error.message).toMatch(
      /photo or file/,
    );
    const file = await ctx.prisma.attachment.create({
      data: {
        companyId: company.id,
        entityType: 'upload',
        entityId: ajay.id,
        path: 'x/p.jpg',
        mime: 'image/jpeg',
        size: 1,
        originalName: 'p.jpg',
        uploadedById: ajay.id,
      },
    });
    expect(
      (await act(ajay.api, { action: 'resolve', note: 'Cleaned rollers', attachmentIds: [file.id] })).body
        .status,
    ).toBe('RESOLVED');
    expect((await act(sandeep.api, { action: 'reopen', comment: 'Jammed again' })).body).toMatchObject({
      status: 'IN_PROGRESS',
      reopenCount: 1,
    });
    // A reopened ticket needs fresh proof of the new fix.
    expect(
      (await act(ajay.api, { action: 'resolve', note: 'Replaced the roller', attachmentIds: [] })).status,
    ).toBe(400);
    const file2 = await ctx.prisma.attachment.create({
      data: { ...file, id: undefined, path: 'x/q.jpg', entityType: 'upload', entityId: ajay.id },
    });
    expect(
      (await act(ajay.api, { action: 'resolve', note: 'Replaced the roller', attachmentIds: [file2.id] }))
        .body.status,
    ).toBe('RESOLVED');
    expect((await act(ajay.api, { action: 'confirm' })).status).toBe(403);
    expect((await act(sandeep.api, { action: 'confirm' })).body).toMatchObject({
      status: 'CLOSED',
      closedBy: 'raiser',
    });
    expect(await events(company.id, 'ticket.')).toEqual([
      'ticket.raised',
      'ticket.replied',
      'ticket.resolved',
      'ticket.reopened',
      'ticket.resolved',
      'ticket.closed',
    ]);
  });

  it('escalates to the coordinator, then the HOD and owner; auto-closes when chosen', async () => {
    const { api, company, owner, sandeep, ajay, other } = await team();
    await api.put('/api/work/settings/ticket', { coordinatorUserId: other.id, closeBy: 'auto24h' });
    const t = (
      await sandeep.api.post('/api/tickets', {
        title: 'AC not cooling',
        solverId: ajay.id,
        plannedFixAt: inHours(48),
      })
    ).body;
    expect(t.coordinatorId).toBe(other.id);
    const back = (h: number) =>
      ctx.prisma.ticket.update({
        where: { id: t.id },
        data: { createdAt: new Date(Date.now() - h * 3600_000) },
      });
    await back(5);
    await sweepTickets(ctx.prisma);
    await back(9);
    await sweepTickets(ctx.prisma);
    await sweepTickets(ctx.prisma);
    const esc = await ctx.prisma.domainEvent.findMany({
      where: { companyId: company.id, name: 'ticket.escalated' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(esc.map((e) => (e.payload as { level: number }).level)).toEqual([1, 2]);
    expect((esc[0]!.payload as { userId: string[] }).userId).toEqual([other.id]);
    expect((esc[1]!.payload as { userId: string[] }).userId).toContain(owner.id);

    await ctx.prisma.ticket.update({
      where: { id: t.id },
      data: { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 25 * 3600_000) },
    });
    await sweepTickets(ctx.prisma);
    expect(await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      status: 'CLOSED',
      closedBy: 'auto',
    });
  });
});

describe('EA board', () => {
  it('captures, schedules within the day, caps waiting, delegates and rolls missed days', async () => {
    const { api, company, owner, sandeep } = await team();
    const today = localDate(new Date(), TZ);
    const item = (await api.post('/api/ea/items', { text: 'Call the GST consultant' })).body;
    expect(item).toMatchObject({ stage: 'CAPTURED', ownerId: owner.id });
    const act = (id: string, body: object) => api.post(`/api/ea/items/${id}/actions`, body);
    expect(
      (await act(item.id, { action: 'schedule', date: today, start: '07:00', minutes: 30, kind: 'call' }))
        .body.error.message,
    ).toMatch(/between 08:00 and 20:00/);
    expect(
      (await act(item.id, { action: 'schedule', date: today, start: '10:00', minutes: 30, kind: 'call' }))
        .body,
    ).toMatchObject({ stage: 'SCHEDULED', slotStart: 600 });

    await api.put('/api/work/settings/ea', { waitingCap: 1 });
    const a = (await api.post('/api/ea/items', { text: 'Quote from Jai Ambe' })).body;
    const b = (await api.post('/api/ea/items', { text: 'Reply from the bank' })).body;
    expect((await act(a.id, { action: 'toWaiting', waitingOn: 'Jai Ambe' })).body.stage).toBe('WAITING');
    expect((await act(b.id, { action: 'toWaiting' })).body.error.code).toBe('GUARD_FAILED');

    const d = (await act(b.id, { action: 'delegate', doerId: sandeep.id, plannedAt: inHours(24) })).body;
    expect(d.stage).toBe('DELEGATED');
    await ctx.prisma.task.update({ where: { id: d.taskId }, data: { status: 'DONE', doneAt: new Date() } });
    await ctx.prisma.eaItem.update({ where: { id: item.id }, data: { scheduledDate: addDays(today, -1) } });
    await eaJobs(ctx.prisma, new Date(), company.id);
    const after = await ctx.prisma.eaItem.findMany({
      where: { companyId: company.id },
      orderBy: { number: 'asc' },
    });
    expect(after.map((x) => x.stage)).toEqual(['SOMEDAY', 'WAITING', 'DONE']);

    const board = (await api.get('/api/ea/board')).body;
    expect(board.counts).toMatchObject({ SOMEDAY: 1, WAITING: 1, DONE: 1 });
    expect((await sandeep.api.get('/api/ea/board')).status).toBe(403);
  });

  it('sends the daily brief once, at the brief time', async () => {
    const { api, company } = await team();
    await api.post('/api/ea/items', { text: 'Sign the cheques' });
    const today = localDate(new Date(), TZ);
    await eaJobs(ctx.prisma, zonedToUtc(today, 8 * 60, TZ), company.id);
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: company.id, name: 'ea.daily_brief' } }),
    ).toBe(0);
    await eaJobs(ctx.prisma, zonedToUtc(today, 8 * 60 + 31, TZ), company.id);
    await eaJobs(ctx.prisma, zonedToUtc(today, 8 * 60 + 40, TZ), company.id);
    const briefs = await ctx.prisma.domainEvent.findMany({
      where: { companyId: company.id, name: 'ea.daily_brief' },
    });
    expect(briefs).toHaveLength(1);
    expect((briefs[0]!.payload as { brief: string }).brief).toContain('To sort: 1 new capture.');
  });

  it('builds the brief text', () => {
    const base = {
      kind: null,
      scheduledDate: null,
      slotStart: null,
      slotMinutes: null,
      stageChangedAt: new Date('2026-11-01T00:00:00Z'),
      taskStatus: null,
    };
    const text = buildBrief(
      '2026-11-02',
      [
        {
          ...base,
          number: 1,
          text: 'Board meeting',
          stage: 'SCHEDULED',
          kind: 'meeting',
          scheduledDate: '2026-11-02',
          slotStart: 660,
          slotMinutes: 60,
        },
        {
          ...base,
          number: 2,
          text: 'Call bank',
          stage: 'SCHEDULED',
          kind: 'call',
          scheduledDate: '2026-11-02',
          slotStart: 540,
          slotMinutes: 15,
        },
        { ...base, number: 3, text: 'Dispatch report', stage: 'DELEGATED', taskStatus: 'OPEN' },
        { ...base, number: 4, text: 'Expand warehouse', stage: 'SOMEDAY' },
      ],
      { waitingCap: 6, somedayReviewDays: 7, delegationFollowUpDays: 2 },
      new Date('2026-11-04T00:00:00Z'),
    );
    expect(text.split('\n')).toEqual([
      'Today (2):',
      '📞 09:00–09:15 Call bank',
      '👥 11:00–12:00 Board meeting',
      'Waiting: 0 of 6.',
      '',
      'Delegated, still open — follow up:',
      '• #3 Dispatch report',
      '',
      'Someday review today: 1 item.', // every 7 days, counted from Monday 05/01/2026
    ]);
  });
});

describe('flow designer settings', () => {
  it('"EA verifies" off sends Mark done straight to Done', async () => {
    const { api, sandeep, other } = await team();
    expect((await other.api.put('/api/work/settings/delegation', { eaVerifies: false })).status).toBe(403);
    const give = async () =>
      (
        await api.post('/api/tasks', {
          doerId: sandeep.id,
          plannedAt: inHours(5),
          description: 'Stock count',
        })
      ).body;
    const doIt = async (id: string) => {
      await sandeep.api.post(`/api/tasks/${id}/actions`, { action: 'accept' });
      return (await sandeep.api.post(`/api/tasks/${id}/actions`, { action: 'markDone', note: 'Counted' }))
        .body.status;
    };
    expect(await doIt((await give()).id)).toBe('PENDING_VERIFY');
    expect((await api.put('/api/work/settings/delegation', { eaVerifies: false })).body.eaVerifies).toBe(
      false,
    );
    expect(await doIt((await give()).id)).toBe('DONE');

    const overview = (await api.get('/api/engine')).body;
    expect(overview.map((m: { module: string }) => m.module)).toEqual([
      'checklist',
      'delegation',
      'slip',
      'ticket',
      'ea',
    ]);
    const del = overview.find((m: { module: string }) => m.module === 'delegation');
    expect(del).toMatchObject({ custom: true, alerts: { total: 13 } });
    expect(del.alerts.active).toBeGreaterThan(5);
    const changes = (await api.get('/api/engine/delegation/changes')).body;
    expect(changes[0]).toMatchObject({ actorName: 'Test Owner', after: { eaVerifies: false } });

    expect((await api.put('/api/work/settings/ea', { eaUserId: 'nobody' })).status).toBe(400);
    expect((await api.del('/api/work/settings/delegation')).body.eaVerifies).toBe(true);
    expect(
      (await api.get('/api/engine')).body.find((m: { module: string }) => m.module === 'delegation').custom,
    ).toBe(false);
  });
});

describe('weekly MIS', () => {
  it('shows people what they may see, renders a PDF and sends once on Monday', async () => {
    const { api, company, sandeep } = await team();
    await api.post('/api/tasks', { doerId: sandeep.id, plannedAt: inHours(-2), description: 'Late one' });
    const all = (await api.get('/api/mis')).body;
    expect(all.rows.length).toBe(4);
    const mine = (await sandeep.api.get('/api/mis')).body;
    expect(mine.rows.map((r: { name: string }) => r.name)).toEqual(['Sandeep Pal']);
    expect(mine.rows[0].tasks.done).toMatchObject({ total: 1, good: 0, pct: 0 });

    const people = await ctx.prisma.user.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true, mainDepartment: { select: { name: true } } },
    });
    const pdf = await misPdf(await misFor(ctx.prisma, company.id, people, new Date()), 'Test Co', 'MONO');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');

    // Monday 09:05 next week (company time): last week's MIS to the owner, once.
    const today = localDate(new Date(), TZ);
    const monday = addDays(today, 8 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) - 1);
    const at = zonedToUtc(monday, 9 * 60 + 5, TZ);
    await sendWeeklyMis(ctx.prisma, at, company.id);
    await sendWeeklyMis(ctx.prisma, at, company.id);
    const sent = await ctx.prisma.domainEvent.findMany({
      where: { companyId: company.id, name: 'mis.weekly' },
    });
    expect(sent).toHaveLength(1);
    expect((sent[0]!.payload as { summary: string }).summary).toMatch(/Average score|No work/);
  });
});
