import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flagOverdueTasks } from './jobs';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

/** Owner + two members (doer, verifier) who can log in. */
async function team() {
  const o = await ownerClient(ctx.app);
  const make = async (name: string) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
    const api = await signedIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: `${name.split(' ')[0]}12345`,
    });
    return { id: r.person.id as string, api };
  };
  return {
    ...o,
    doer: await make('Sandeep Pal'),
    verifier: await make('Ajay Meena'),
    stranger: await make('Other Person'),
  };
}

const events = (companyId: string) =>
  ctx.prisma.domainEvent
    .findMany({ where: { companyId, name: { startsWith: 'delegation.' } }, orderBy: { occurredAt: 'asc' } })
    .then((e) => e.map((x) => x.name));

describe('delegation lifecycle', () => {
  it('assign → accept → done with proof → verify, with events for every step', async () => {
    const { api, company, doer, verifier } = await team();
    const created = await api.post('/api/tasks', {
      doerId: doer.id,
      verifierId: verifier.id,
      plannedAt: inHours(5),
      description: 'Calibrate press 2 gauges',
      requireProof: true,
    });
    expect(created.status).toBe(200);
    const task = created.body;
    expect(task).toMatchObject({ number: 1, status: 'AWAITING_ACCEPTANCE' });

    expect((await api.post(`/api/tasks/${task.id}/actions`, { action: 'accept' })).body.error.code).toBe(
      'FORBIDDEN_TRANSITION',
    );
    expect((await doer.api.post(`/api/tasks/${task.id}/actions`, { action: 'accept' })).body.status).toBe(
      'OPEN',
    );

    const noProof = await doer.api.post(`/api/tasks/${task.id}/actions`, {
      action: 'markDone',
      note: 'Calibrated both gauges',
    });
    expect(noProof.status).toBe(400);
    const file = await ctx.prisma.attachment.create({
      data: {
        companyId: company.id,
        entityType: 'upload',
        entityId: doer.id,
        path: 'x/y.jpg',
        mime: 'image/jpeg',
        size: 3,
        originalName: 'p.jpg',
        uploadedById: doer.id,
      },
    });
    const done = await doer.api.post(`/api/tasks/${task.id}/actions`, {
      action: 'markDone',
      note: 'Calibrated both gauges',
      attachmentIds: [file.id],
    });
    expect(done.body.status).toBe('PENDING_VERIFY');
    expect((await ctx.prisma.attachment.findUniqueOrThrow({ where: { id: file.id } })).entityType).toBe(
      'task',
    );

    expect((await verifier.api.post(`/api/tasks/${task.id}/actions`, { action: 'verify' })).body.status).toBe(
      'DONE',
    );
    expect(await events(company.id)).toEqual([
      'delegation.assigned',
      'delegation.accepted',
      'delegation.done',
      'delegation.verified',
    ]);
    const detail = (await api.get(`/api/tasks/${task.id}`)).body;
    expect(detail.events.map((e: { type: string }) => e.type)).toContain('status');
    expect(detail.files).toHaveLength(1);
  });

  it('moves the date (revision), follows up, rejects and reopens', async () => {
    const { api, company, doer, verifier } = await team();
    const t = (
      await api.post('/api/tasks', {
        doerId: doer.id,
        verifierId: verifier.id,
        plannedAt: inHours(5),
        description: 'Resin stock count',
      })
    ).body;
    await doer.api.post(`/api/tasks/${t.id}/actions`, { action: 'accept' });
    const moved = await doer.api.post(`/api/tasks/${t.id}/actions`, {
      action: 'moveDate',
      plannedAt: inHours(30),
      reason: 'Waiting for the spare part',
    });
    expect(moved.body).toMatchObject({ status: 'OPEN', revisionCount: 1 });
    expect(
      (await verifier.api.post(`/api/tasks/${t.id}/actions`, { action: 'addFollowUp', note: 'Any update?' }))
        .body.status,
    ).toBe('OPEN');
    await doer.api.post(`/api/tasks/${t.id}/actions`, { action: 'markDone', note: 'Counted' });
    const rejected = await verifier.api.post(`/api/tasks/${t.id}/actions`, {
      action: 'reject',
      comment: 'Count the back store too',
    });
    expect(rejected.body).toMatchObject({ status: 'OPEN', reopenCount: 1, doneAt: null });
    expect((await events(company.id)).slice(-2)).toEqual(['delegation.done', 'delegation.rejected']);
  });

  it('declines back to the creator, who reassigns; cancel by creator only', async () => {
    const { api, doer, verifier } = await team();
    const t = (
      await api.post('/api/tasks', { doerId: doer.id, plannedAt: inHours(5), description: 'Send price list' })
    ).body;
    expect(
      (await doer.api.post(`/api/tasks/${t.id}/actions`, { action: 'decline', reason: 'Not my area' })).body
        .status,
    ).toBe('RETURNED_TO_CREATOR');
    const re = await api.post(`/api/tasks/${t.id}/actions`, { action: 'reassign', doerId: verifier.id });
    expect(re.body).toMatchObject({ status: 'AWAITING_ACCEPTANCE', doerId: verifier.id });
    expect((await doer.api.post(`/api/tasks/${t.id}/actions`, { action: 'cancel' })).status).toBe(404); // not his task anymore
    expect(
      (await api.post(`/api/tasks/${t.id}/actions`, { action: 'cancel', reason: 'Done by phone' })).body
        .status,
    ).toBe('CANCELLED');
  });

  it('keeps tasks private to the people on them', async () => {
    const { api, doer, stranger } = await team();
    const t = (
      await api.post('/api/tasks', { doerId: doer.id, plannedAt: inHours(5), description: 'Private work' })
    ).body;
    const peek = await stranger.api.get(`/api/tasks/${t.id}`);
    if (peek.status !== 404) throw new Error(JSON.stringify(peek.body));
    expect(peek.status).toBe(404);
    expect((await stranger.api.get('/api/tasks?tab=all')).body.tasks).toHaveLength(0);
    expect((await doer.api.get('/api/tasks')).body.tasks.map((x: { id: string }) => x.id)).toContain(t.id);
    const ownerView = (await api.get('/api/tasks')).body;
    expect(ownerView.scope).toBe('all');
    expect(ownerView.tasks[0].actions).toEqual(expect.arrayContaining(['cancel', 'reassign']));
  });

  it('imports many, flags overdue once a day, and reports', async () => {
    const { api, company, doer } = await team();
    const res = await api.post('/api/tasks/import', {
      tasks: [
        { doerId: doer.id, plannedAt: inHours(-30), description: 'Late one' },
        { doerId: doer.id, plannedAt: inHours(48), description: 'Future one' },
      ],
    });
    expect(res.body.created).toBe(2);
    const late = await ctx.prisma.task.findFirstOrThrow({
      where: { companyId: company.id, description: 'Late one' },
    });
    expect(await flagOverdueTasks(ctx.prisma)).toBeGreaterThanOrEqual(1);
    const again = await flagOverdueTasks(ctx.prisma);
    const overdueEvents = await ctx.prisma.domainEvent.count({
      where: { companyId: company.id, name: 'delegation.overdue', entityId: late.id },
    });
    expect(overdueEvents).toBe(1);
    expect(again).toBe(0);

    const tilesRes = await doer.api.get('/api/tasks/tiles');
    if (tilesRes.status !== 200) throw new Error(JSON.stringify(tilesRes.body));
    const tiles = tilesRes.body;
    expect(tiles).toMatchObject({ pending: 2, overdue: 1 });
    expect((await doer.api.get('/api/work/counts')).body.delegation).toBe(2);
    const score = (await api.get('/api/tasks/reports/scorecard')).body;
    expect(score.rows.map((r: { name: string }) => r.name)).toContain('Sandeep Pal');
    const ryg = (
      await api.get(
        `/api/tasks/reports/ryg?from=${encodeURIComponent(inHours(-24 * 30))}&to=${encodeURIComponent(inHours(24 * 30))}`,
      )
    ).body;
    expect(ryg.find((r: { name: string }) => r.name === 'Sandeep Pal')).toMatchObject({
      total: 2,
      red: 1,
      open: 1,
    });
  });

  it("closes the owner's own task without a verification, and doesn't score one as missing", async () => {
    const { api, owner } = await team();
    const mine = (
      await api.post('/api/tasks', { doerId: owner.id, plannedAt: inHours(5), description: 'Own' })
    ).body;
    expect(mine.status).toBe('OPEN'); // self-assigned: nothing to accept
    expect((await api.get(`/api/tasks/${mine.id}`)).body.verifierId).toBeNull();
    const done = await api.post(`/api/tasks/${mine.id}/actions`, { action: 'markDone', note: 'Done early' });
    expect(done.body.status).toBe('DONE');
    const score = (await api.get('/api/tasks/reports/scorecard')).body;
    const lines = score.rows.find((r: { personId: string }) => r.personId === owner.id).lines;
    const by = Object.fromEntries(lines.map((l: { kpi: string }) => [l.kpi, l]));
    expect(by.notDone).toMatchObject({ planned: 1, actualPct: 0 }); // done early counts now
    expect(by.verifyPending.planned).toBe(0);
  });
});
