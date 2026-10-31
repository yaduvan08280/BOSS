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
});
