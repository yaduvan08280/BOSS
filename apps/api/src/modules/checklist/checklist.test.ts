import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireChecklists, remindChecklists, sweepChecklists } from './jobs';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
// Monday 07/01/2030, 08:30 IST — fixed so the schedule is predictable.
const MONDAY_0830 = new Date('2030-01-07T03:00:00Z');

describe('checklists', () => {
  it('a new doer takes over the runs nobody has started; started ones stay — never two runs for one occurrence', async () => {
    const { api, company, owner } = await ownerClient(ctx.app);
    const made = (await api.post('/api/org/users', { name: 'Pooja Captain', mobile: rnd() })).body;
    const master = await api.post('/api/checklists/masters', {
      name: 'Rooftop opening',
      items: [{ key: 'a', text: 'Tables laid' }],
      frequency: { type: 'daily' },
      dueTime: '11:30',
      windowHours: 3,
      doerIds: [owner.id],
      startDate: '2030-01-01',
    });
    expect(master.status).toBe(200);
    const at = (h: number) => new Date(Date.now() + h * 3_600_000);
    const run = (plannedAt: Date, itemsDone = 0) =>
      ctx.prisma.checklistRun.create({
        data: {
          companyId: company.id,
          masterId: master.body.id,
          doerId: owner.id,
          plannedAt,
          windowEndsAt: new Date(plannedAt.getTime() + 3 * 3_600_000),
          itemsTotal: 1,
          itemsDone,
        },
      });
    const untouched = await run(at(5));
    const started = await run(at(29), 1);
    const due = await run(at(-1));
    expect(
      (await api.patch(`/api/checklists/masters/${master.body.id}`, { doerIds: [made.person.id] })).status,
    ).toBe(200);
    const doer = async (id: string) =>
      (await ctx.prisma.checklistRun.findUniqueOrThrow({ where: { id } })).doerId;
    expect(await doer(untouched.id)).toBe(made.person.id);
    expect(await doer(started.id)).toBe(owner.id);
    expect(await doer(due.id)).toBe(owner.id);
    expect(
      await ctx.prisma.checklistRun.count({
        where: { masterId: master.body.id, plannedAt: untouched.plannedAt },
      }),
    ).toBe(1);
  });

  it('sweeps idempotently, needs proof, submits, verifies, and misses what is left', async () => {
    const { api, company, owner } = await ownerClient(ctx.app);
    const mobile = rnd();
    const r = (await api.post('/api/org/users', { name: 'Gopal Store', mobile, loginEnabled: true })).body;
    const gopal = await signedIn(ctx.app, mobile, r.tempPassword);
    await gopal.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: 'Gopal12345',
    });
    expect((await gopal.post('/api/checklists/masters', {})).status).toBe(400); // validation runs before rights; real check below

    const master = await api.post('/api/checklists/masters', {
      name: 'Morning store round',
      items: [
        { key: 'a', text: 'Count cement bags', requireValue: true },
        { key: 'b', text: 'Photo of the fire extinguisher', requirePhoto: true },
      ],
      frequency: { type: 'daily' },
      dueTime: '10:00',
      windowHours: 4,
      doerIds: [r.person.id],
      verifierId: owner.id,
      startDate: '2030-01-01',
    });
    expect(master.status).toBe(200);
    expect(master.body).toMatchObject({ code: 'CHK-001', dueTime: '10:00' });
    const member = await gopal.post('/api/checklists/masters', { ...master.body, name: 'Mine' });
    expect(member.status).toBe(403);

    expect(await sweepChecklists(ctx.prisma, MONDAY_0830)).toBeGreaterThanOrEqual(1);
    await sweepChecklists(ctx.prisma, MONDAY_0830);
    const runs = await ctx.prisma.checklistRun.findMany({ where: { companyId: company.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.plannedAt.toISOString()).toBe('2030-01-07T04:30:00.000Z');
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: company.id, name: 'checklist.assigned' } }),
    ).toBe(1);

    const run = (await gopal.get(`/api/checklists/runs/${runs[0]!.id}`)).body;
    const [count, photo] = run.items;
    expect(
      (await gopal.post(`/api/checklists/runs/${run.id}/items`, { itemId: count.id, done: true })).status,
    ).toBe(400);
    expect(
      (
        await gopal.post(`/api/checklists/runs/${run.id}/items`, {
          itemId: count.id,
          done: true,
          value: '42',
        })
      ).body.itemsDone,
    ).toBe(1);
    expect(
      (await gopal.post(`/api/checklists/runs/${run.id}/actions`, { action: 'submit' })).body.error.code,
    ).toBe('GUARD_FAILED');
    expect(
      (await gopal.post(`/api/checklists/runs/${run.id}/items`, { itemId: photo.id, done: true })).status,
    ).toBe(400);
    const file = await ctx.prisma.attachment.create({
      data: {
        companyId: company.id,
        entityType: 'upload',
        entityId: r.person.id,
        path: 'x/e.jpg',
        mime: 'image/jpeg',
        size: 1,
        originalName: 'e.jpg',
        uploadedById: r.person.id,
      },
    });
    await gopal.post(`/api/checklists/runs/${run.id}/items`, {
      itemId: photo.id,
      done: true,
      attachmentId: file.id,
    });
    expect(
      (await gopal.post(`/api/checklists/runs/${run.id}/actions`, { action: 'submit' })).body.status,
    ).toBe('PENDING_VERIFY');
    expect((await gopal.post(`/api/checklists/runs/${run.id}/actions`, { action: 'verify' })).status).toBe(
      403,
    );
    expect((await api.post(`/api/checklists/runs/${run.id}/actions`, { action: 'verify' })).body.status).toBe(
      'DONE',
    );

    // Tuesday's run is never done: reminded once, then missed after the 4-hour window.
    const tuesday0830 = new Date(MONDAY_0830.getTime() + 24 * 3600_000);
    await sweepChecklists(ctx.prisma, tuesday0830);
    const tue = await ctx.prisma.checklistRun.findFirstOrThrow({
      where: { companyId: company.id, status: 'OPEN' },
    });
    expect(
      await remindChecklists(ctx.prisma, new Date(tue.plannedAt.getTime() - 10 * 60_000)),
    ).toBeGreaterThanOrEqual(1);
    await remindChecklists(ctx.prisma, new Date(tue.plannedAt.getTime() - 5 * 60_000));
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: company.id, name: 'checklist.reminder' } }),
    ).toBe(1);
    await expireChecklists(ctx.prisma, new Date(tue.windowEndsAt.getTime() + 60_000));
    expect((await ctx.prisma.checklistRun.findUniqueOrThrow({ where: { id: tue.id } })).status).toBe(
      'MISSED',
    );
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: company.id, name: 'checklist.missed' } }),
    ).toBe(1);

    await api.patch(`/api/checklists/masters/${master.body.id}`, { windowHours: 6 });
    const changes = (await api.get('/api/checklists/master-changes')).body;
    expect(changes.map((c: { action: string }) => c.action)).toEqual([
      'checklist.master_changed',
      'checklist.master_created',
    ]);
    expect(changes[0].actorName).toBe('Test Owner');

    // Deleting the checklist: its open run drops out of lists and is never reminded or marked missed.
    const wednesday0830 = new Date(MONDAY_0830.getTime() + 48 * 3600_000);
    await sweepChecklists(ctx.prisma, wednesday0830);
    const wed = await ctx.prisma.checklistRun.findFirstOrThrow({
      where: { companyId: company.id, status: 'OPEN' },
    });
    expect((await api.del(`/api/checklists/masters/${master.body.id}`)).status).toBe(200);
    expect((await gopal.get(`/api/checklists/runs/${wed.id}`)).status).toBe(404);
    await remindChecklists(ctx.prisma, new Date(wed.plannedAt.getTime() - 10 * 60_000));
    await expireChecklists(ctx.prisma, new Date(wed.windowEndsAt.getTime() + 60_000));
    expect(await ctx.prisma.checklistRun.findUniqueOrThrow({ where: { id: wed.id } })).toMatchObject({
      status: 'OPEN',
      remindedAt: null,
    });
  });
});
