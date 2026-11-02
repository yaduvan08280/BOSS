import { EventEmitter } from 'node:events';
import pg from 'pg';
import type { Prisma, Tx } from '@mono/db';
import type { DomainEventName } from '@mono/shared';
import { type ActorContext, writeAudit } from './audit';

export const EVENTS_CHANNEL = 'mono_events';
/** New in-app notifications, so open browsers update the bell immediately. */
export const NOTIFICATIONS_CHANNEL = 'mono_notifications';

export type NotificationSignal = { id: string; companyId: string; userId: string };

/** Small payload sent over NOTIFY (8 KB limit); listeners load the full row if they need it. */
export type EventSignal = {
  id: string;
  companyId: string;
  name: DomainEventName;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
};

/**
 * Record a domain event in the outbox. Must run inside the same transaction as the change.
 * The NOTIFY is delivered only when that transaction commits, so listeners never see rolled-back events.
 */
export async function emitEvent(
  tx: Tx,
  ctx: ActorContext,
  event: { name: DomainEventName; entityType?: string; entityId?: string; payload?: Record<string, unknown> },
): Promise<EventSignal> {
  const row = await tx.domainEvent.create({
    data: {
      companyId: ctx.companyId,
      name: event.name,
      actorId: ctx.actorId,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      payload: (event.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
  const signal: EventSignal = {
    id: row.id,
    companyId: row.companyId,
    name: event.name,
    actorId: row.actorId,
    entityType: row.entityType,
    entityId: row.entityId,
  };
  await tx.$executeRaw`SELECT pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(signal)})`;
  return signal;
}

/** The usual pair for every mutation: one audit row + one domain event. */
export async function recordChange(
  tx: Tx,
  ctx: ActorContext,
  change: {
    event: DomainEventName;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    payload?: Record<string, unknown>;
  },
): Promise<EventSignal> {
  await writeAudit(tx, ctx, {
    action: change.event,
    entityType: change.entityType,
    entityId: change.entityId,
    before: change.before,
    after: change.after,
  });
  return emitEvent(tx, ctx, {
    name: change.event,
    entityType: change.entityType,
    entityId: change.entityId,
    payload: change.payload,
  });
}

/**
 * In-process bus fed by Postgres LISTEN, so events from any process (api or worker) reach SSE clients.
 * Reconnects automatically if the connection drops.
 */
/** Create an in-app notification and signal it on commit. Use inside a transaction. */
export async function createInAppNotification(
  tx: Tx,
  data: {
    companyId: string;
    userId: string;
    title: string;
    body?: string | null;
    link?: string | null;
    eventId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    tone?: string | null;
  },
) {
  const row = await tx.notification.create({ data });
  const signal: NotificationSignal = { id: row.id, companyId: row.companyId, userId: row.userId };
  await tx.$executeRaw`SELECT pg_notify(${NOTIFICATIONS_CHANNEL}, ${JSON.stringify(signal)})`;
  return row;
}

export class EventListener extends EventEmitter<{
  event: [EventSignal];
  notification: [NotificationSignal];
}> {
  private client: pg.Client | null = null;
  private stopped = false;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly log: { warn: (o: object, msg: string) => void } = console,
  ) {
    super();
    this.setMaxListeners(0);
  }

  async start(): Promise<void> {
    this.stopped = false;
    const client = new pg.Client({ connectionString: this.url });
    client.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        if (msg.channel === EVENTS_CHANNEL) this.emit('event', JSON.parse(msg.payload) as EventSignal);
        else if (msg.channel === NOTIFICATIONS_CHANNEL)
          this.emit('notification', JSON.parse(msg.payload) as NotificationSignal);
      } catch (err) {
        this.log.warn({ err }, 'Bad event payload');
      }
    });
    client.on('error', (err) => {
      this.log.warn({ err }, 'Event listener connection lost; reconnecting');
      this.scheduleReconnect();
    });
    await client.connect();
    await client.query(`LISTEN ${EVENTS_CHANNEL}`);
    await client.query(`LISTEN ${NOTIFICATIONS_CHANNEL}`);
    this.client = client;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;
    this.client?.end().catch(() => undefined);
    this.client = null;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start().catch(() => this.scheduleReconnect());
    }, 2000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.client?.end().catch(() => undefined);
    this.client = null;
  }
}
