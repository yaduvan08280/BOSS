import type { Db, DomainEvent } from '@mono/db';
import type { DomainEventName } from '@mono/shared';

export type EventHandler = (event: DomainEvent, db: Db) => Promise<void>;

/** Handlers per event. Phase 2 plugs the notification-rule engine in here. */
export type HandlerRegistry = Partial<Record<DomainEventName | '*', EventHandler[]>>;

export const MAX_ATTEMPTS = 5;

/**
 * Take a batch of undispatched outbox events (row-locked, so several workers never double-send),
 * run their handlers, and mark them dispatched. A failing event is retried later with backoff.
 */
export async function dispatchPending(db: Db, handlers: HandlerRegistry, batchSize = 50): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM domain_events
      WHERE dispatched_at IS NULL AND attempts < ${MAX_ATTEMPTS}
        AND (attempts = 0 OR occurred_at < now() - make_interval(secs => power(2, attempts) * 30))
      ORDER BY occurred_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return 0;
    const events = await tx.domainEvent.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: { occurredAt: 'asc' },
    });
    for (const event of events) {
      const list = [...(handlers[event.name as DomainEventName] ?? []), ...(handlers['*'] ?? [])];
      try {
        for (const handle of list) await handle(event, db);
        await tx.domainEvent.update({ where: { id: event.id }, data: { dispatchedAt: new Date() } });
      } catch (err) {
        await tx.domainEvent.update({
          where: { id: event.id },
          data: {
            attempts: { increment: 1 },
            lastError: String((err as Error)?.message ?? err).slice(0, 500),
          },
        });
      }
    }
    return events.length;
  });
}
