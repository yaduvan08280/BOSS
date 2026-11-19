import type { Db, DomainEvent } from '@mono/db';
import type { DomainEventName } from '@mono/shared';

export type EventHandler = (event: DomainEvent, db: Db) => Promise<void>;

/** Handlers per event. Phase 2 plugs the notification-rule engine in here. */
export type HandlerRegistry = Partial<Record<DomainEventName | '*', EventHandler[]>>;

export const MAX_ATTEMPTS = 5;

/** Asked once per batch: the ids of events no rule or webhook is waiting for (their '*' handlers are skipped). */
export type Unheard = (db: Db, events: DomainEvent[]) => Promise<Set<string>>;

/**
 * Take a batch of undispatched outbox events (row-locked, so several workers never double-send),
 * run their handlers, and mark them dispatched. A failing event is retried later with backoff.
 * Events that went well are marked in one statement at the end of the batch.
 */
export async function dispatchPending(
  db: Db,
  handlers: HandlerRegistry,
  batchSize = 50,
  unheard?: Unheard,
): Promise<number> {
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
    const quiet = unheard ? await unheard(db, events) : new Set<string>();
    const done: string[] = [];
    for (const event of events) {
      const list = [
        ...(handlers[event.name as DomainEventName] ?? []),
        ...(quiet.has(event.id) ? [] : (handlers['*'] ?? [])),
      ];
      try {
        for (const handle of list) await handle(event, db);
        done.push(event.id);
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
    if (done.length)
      await tx.domainEvent.updateMany({ where: { id: { in: done } }, data: { dispatchedAt: new Date() } });
    return events.length;
  });
}
