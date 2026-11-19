import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrisma } from '@mono/db';
import { recordChange } from '@mono/api/services';
import { dispatchPending, type HandlerRegistry } from './dispatch-events';

const db = createPrisma();
let companyId = '';

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: 'Dispatch Co', slug: `dispatch-${Date.now()}` } })).id;
  // Clear anything other test files left undispatched so this run only sees our events.
  await db.domainEvent.updateMany({ where: { dispatchedAt: null }, data: { dispatchedAt: new Date() } });
});
afterAll(async () => {
  await db.$disconnect();
});

describe('dispatchPending()', () => {
  it('runs handlers once and marks events dispatched', async () => {
    await db.$transaction((tx) =>
      recordChange(
        tx,
        { companyId, actorId: null },
        { event: 'user.created', entityType: 'user', entityId: 'u1' },
      ),
    );
    const seen = vi.fn(async () => undefined);
    const handlers: HandlerRegistry = { 'user.created': [seen] };
    expect(await dispatchPending(db, handlers)).toBe(1);
    expect(await dispatchPending(db, handlers)).toBe(0);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('keeps failing events for a retry with the error recorded', async () => {
    await db.$transaction((tx) =>
      recordChange(
        tx,
        { companyId, actorId: null },
        { event: 'user.created', entityType: 'user', entityId: 'u2' },
      ),
    );
    const handlers: HandlerRegistry = {
      '*': [
        async () => {
          throw new Error('provider down');
        },
      ],
    };
    await dispatchPending(db, handlers);
    const row = await db.domainEvent.findFirstOrThrow({ where: { companyId, entityId: 'u2' } });
    expect(row.dispatchedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('provider down');
    // Backoff: not picked up again straight away.
    expect(await dispatchPending(db, handlers)).toBe(0);
  });
  it('asks once for a batch who is listening, and skips the catch-all handlers of events nobody hears', async () => {
    const { unheardEvents } = await import('@mono/api/services');
    await db.domainEvent.updateMany({ where: { dispatchedAt: null }, data: { dispatchedAt: new Date() } });
    const other = await db.company.create({ data: { name: 'Listening Co', slug: `listen-${Date.now()}` } });
    // The first company has a rule for one event; the second a webhook that asks for a whole module.
    await db.notificationRule.create({
      data: {
        companyId,
        event: 'pos.order_paid',
        audience: 'team',
        recipients: ['owner'],
        channels: ['inapp'],
      },
    });
    const maker = await db.user.findFirst({ where: { companyId: other.id } });
    await db.webhook.create({
      data: {
        companyId: other.id,
        url: 'https://example.com/hook',
        events: ['pos.*'],
        secret: 'x',
        createdById: maker?.id ?? null,
      },
    });
    const emit = (cid: string, event: string, entityId: string) =>
      db.$transaction((tx) =>
        recordChange(
          tx,
          { companyId: cid, actorId: null },
          { event: event as never, entityType: 'x', entityId },
        ),
      );
    await emit(companyId, 'pos.order_paid', 'heard-by-rule');
    await emit(companyId, 'pos.order_opened', 'unheard-1');
    await emit(companyId, 'user.created', 'unheard-named');
    await emit(other.id, 'pos.order_opened', 'heard-by-webhook');
    await emit(other.id, 'auth.login', 'private-never-sent');
    for (let i = 0; i < 40; i++) await emit(companyId, 'pos.kot_ready', `unheard-bulk-${i}`);

    const all = vi.fn(async () => undefined);
    const named = vi.fn(async () => undefined);
    const asked = vi.fn(unheardEvents);
    const handlers: HandlerRegistry = { '*': [all], 'user.created': [named] };
    expect(await dispatchPending(db, handlers, 50, asked)).toBe(45);
    expect(asked).toHaveBeenCalledTimes(1);
    const heard = all.mock.calls.map((c) => (c as unknown as [{ entityId: string }])[0].entityId).sort();
    expect(heard).toEqual(['heard-by-rule', 'heard-by-webhook']);
    expect(named).toHaveBeenCalledTimes(1); // a handler named for the event still runs
    expect(await db.domainEvent.count({ where: { dispatchedAt: null } })).toBe(0);
    expect(await dispatchPending(db, handlers, 50, asked)).toBe(0);
  });
});
