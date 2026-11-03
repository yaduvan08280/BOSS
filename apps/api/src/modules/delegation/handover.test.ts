import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

/** Owner + three people who each do a part, and one who has nothing to do with the task. */
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
    a: await make('Ramesh Gurjar'),
    b: await make('Sunita Sharma'),
    c: await make('Vikram Singh'),
    outsider: await make('Other Person'),
  };
}

const lastEvent = (companyId: string, name: string) =>
  ctx.prisma.domainEvent.findFirstOrThrow({
    where: { companyId, name },
    orderBy: { occurredAt: 'desc' },
  });

describe('passing a task on and notes', () => {
  it('moves one task through three people, keeps everyone who did a part in the loop', async () => {
    const { api, company, owner, a, b, c, outsider } = await team();
    const boss = { api };
    const task = (
      await api.post('/api/tasks', {
        doerId: a.id,
        plannedAt: inHours(3),
        description: 'Get the export order ready: quote, sample, dispatch',
      })
    ).body;
    const act = (who: { api: typeof api }, body: object) =>
      who.api.post(`/api/tasks/${task.id}/actions`, body);
    await act(a, { action: 'accept' });

    // Wrong passes are refused.
    expect(
      (await act(a, { action: 'passOn', doerId: a.id, note: 'Quote sent', plannedAt: inHours(5) })).status,
    ).toBe(400);
    const past = await act(a, { action: 'passOn', doerId: b.id, note: 'Quote sent', plannedAt: inHours(-3) });
    expect(past.body.error.message).toMatch(/has not passed/);
    expect((await act(a, { action: 'passOn', doerId: b.id, note: 'ok', plannedAt: inHours(5) })).status).toBe(
      400,
    );
    expect(
      (await act(boss, { action: 'passOn', doerId: b.id, note: 'Quote sent', plannedAt: inHours(5) })).body
        .error.code,
    ).toBe('FORBIDDEN_TRANSITION');

    // A did the quote: the same task goes to B, who accepts it like a new task.
    const passed = await act(a, {
      action: 'passOn',
      doerId: b.id,
      note: 'Quote sent and approved by the buyer',
      plannedAt: inHours(24),
    });
    expect(passed.body).toMatchObject({
      doerId: b.id,
      status: 'AWAITING_ACCEPTANCE',
      passCount: 1,
      revisionCount: 0,
      number: task.number,
    });
    const ev = await lastEvent(company.id, 'delegation.passed_on');
    expect(ev.payload).toMatchObject({
      doerId: b.id,
      creatorId: owner.id,
      note: 'Quote sent and approved by the buyer',
      telegramActions: ['accept'],
      telegramActionsFor: b.id,
    });

    // A no longer acts on it, but still sees it (in their list too) and can write notes.
    expect((await act(a, { action: 'markDone', note: 'done it all' })).body.error.code).toMatch(
      /^(FORBIDDEN|INVALID)_TRANSITION$/,
    );
    expect((await a.api.get(`/api/tasks/${task.id}`)).status).toBe(200);
    const listed = (await a.api.get('/api/tasks?scope=mine&tab=pending')).body.tasks;
    expect(listed.map((t: { id: string }) => t.id)).toContain(task.id);
    expect((await act(a, { action: 'addNote', note: 'Buyer wants the sample by Friday' })).status).toBe(200);

    // Someone with nothing to do with it can't see it or write on it.
    expect((await outsider.api.get(`/api/tasks/${task.id}`)).status).toBe(404);
    expect((await act(outsider, { action: 'addNote', note: 'hello' })).status).toBe(404);

    // B passes it on to C; C finishes. B's note reaches A, B and the owner (minus whoever wrote it).
    await act(b, { action: 'accept' });
    await act(b, { action: 'addNote', note: 'Sample couriered, AWB 7781' });
    const note = await lastEvent(company.id, 'delegation.note');
    expect(note.payload).toMatchObject({ doerId: b.id, creatorId: owner.id, helperIds: [a.id] });
    await act(b, { action: 'passOn', doerId: c.id, note: 'Sample sent', plannedAt: inHours(48) });
    await act(c, { action: 'accept' });
    const done = await act(c, { action: 'markDone', note: 'Dispatched, invoice 4512' });
    expect(['PENDING_VERIFY', 'DONE']).toContain(done.body.status);

    // The history names who passed it to whom, and every note keeps its writer.
    const detail = (await api.get(`/api/tasks/${task.id}`)).body;
    const hops = detail.events
      .filter((e: { type: string }) => e.type === 'passed_on')
      .map((e: { fromUserId: string; toUserId: string; actorId: string }) => [
        e.actorId,
        e.fromUserId,
        e.toUserId,
      ]);
    expect(hops).toEqual([
      [a.id, a.id, b.id],
      [b.id, b.id, c.id],
    ]);
    const notes = detail.events
      .filter((e: { type: string }) => e.type === 'note')
      .map((e: { actorId: string; note: string }) => [e.actorId, e.note]);
    expect(notes).toEqual([
      [a.id, 'Buyer wants the sample by Friday'],
      [b.id, 'Sample couriered, AWB 7781'],
    ]);
    expect(detail.passCount).toBe(2);
    // Notes stay possible after the task is finished.
    expect((await act(boss, { action: 'addNote', note: 'Payment received' })).status).toBe(200);
  });

  it('a task passed back to whoever gave it needs no acceptance', async () => {
    const { api, owner, a } = await team();
    const task = (
      await api.post('/api/tasks', { doerId: a.id, plannedAt: inHours(3), description: 'Check the drawing' })
    ).body;
    await a.api.post(`/api/tasks/${task.id}/actions`, { action: 'accept' });
    const back = await a.api.post(`/api/tasks/${task.id}/actions`, {
      action: 'passOn',
      doerId: owner.id,
      note: 'Drawing checked, two changes marked',
      plannedAt: inHours(6),
    });
    expect(back.body).toMatchObject({ doerId: owner.id, status: 'OPEN' });
  });
});
