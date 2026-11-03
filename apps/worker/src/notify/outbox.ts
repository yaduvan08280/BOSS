import type { Db, Outbox } from '@mono/db';
import type { Env } from '@mono/api/env';
import {
  ChannelError,
  channelClients,
  sendEmail,
  sendPush,
  sendTelegram,
  type ChannelClients,
  type OutgoingMessage,
  type Storage,
} from '@mono/api/services';

const readFrom = (storage: Storage) => async (path: string) => {
  const chunks: Buffer[] = [];
  for await (const c of storage.get(path)) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
};

export const MAX_TRIES = 5;
const BASE_DELAY_MS = 30_000;

const realSenders = { telegram: sendTelegram, email: sendEmail, push: sendPush };

export type SenderDeps = {
  db: Db;
  env: Env;
  /** Where proof files live (Telegram uploads them with the message). */
  storage?: Storage;
  /** Tests swap these to avoid real network calls. */
  clientsFor?: (companyId: string) => Promise<ChannelClients>;
  senders?: Partial<typeof realSenders>;
};

async function deliver(row: Outbox, clients: ChannelClients, deps: SenderDeps): Promise<string | null> {
  const msg = row.payload as unknown as OutgoingMessage;
  const { telegram: sendTelegram, email: sendEmail, push: sendPush } = { ...realSenders, ...deps.senders };
  switch (row.channel) {
    case 'telegram':
      if (!clients.telegram) throw new ChannelError('Telegram is not connected', false);
      return (
        (
          await sendTelegram(
            clients.telegram.token,
            row.to,
            msg,
            undefined,
            deps.storage ? readFrom(deps.storage) : undefined,
          )
        ).providerId ?? null
      );
    case 'email':
      if (!clients.email) throw new ChannelError('Email (SMTP) is not set up', false);
      return (
        (await sendEmail(clients.email.transport, clients.email.from, row.to, msg, deps.env.APP_NAME))
          .providerId ?? null
      );
    case 'whatsapp':
      if (!clients.whatsapp) throw new ChannelError('WhatsApp is not connected', false);
      return (await clients.whatsapp.send(row.to, msg)).providerId ?? null;
    case 'push': {
      if (!clients.push) throw new ChannelError('Web push keys are not set up', false);
      const sub = await deps.db.pushSubscription.findUnique({ where: { id: row.to } });
      if (!sub) throw new ChannelError('The device unsubscribed', false);
      try {
        await sendPush(clients.push, sub, msg);
      } catch (err) {
        if (err instanceof ChannelError && !err.retryable)
          await deps.db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        throw err;
      }
      return null;
    }
    default:
      throw new ChannelError(`Unknown channel ${row.channel}`, false);
  }
}

/**
 * Send everything that is due. Rows are claimed with SKIP LOCKED so two workers never send the same message.
 * Failures retry with exponential backoff (30 s, 1 min, 2 min, 4 min) up to 5 tries, then FAILED.
 */
export async function sendDue(deps: SenderDeps, batch = 50): Promise<number> {
  const { db } = deps;
  const claimed = await db.$queryRaw<Outbox[]>`
    UPDATE outbox SET status = 'SENDING', updated_at = now()
    WHERE id IN (
      SELECT id FROM outbox WHERE status = 'QUEUED' AND send_after <= now()
      ORDER BY send_after LIMIT ${batch} FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  if (!claimed.length) return 0;
  const rows = await db.outbox.findMany({ where: { id: { in: claimed.map((r) => r.id) } } });
  const clientCache = new Map<string, ChannelClients>();
  const clientsFor =
    deps.clientsFor ?? ((companyId: string) => channelClients(db as never, companyId, deps.env));

  for (const row of rows) {
    try {
      let clients = clientCache.get(row.companyId);
      if (!clients) {
        clients = await clientsFor(row.companyId);
        clientCache.set(row.companyId, clients);
      }
      const providerId = await deliver(row, clients, deps);
      await db.outbox.update({
        where: { id: row.id },
        data: { status: 'SENT', providerId, sentAt: new Date(), tries: { increment: 1 }, lastError: null },
      });
      if (row.templateCode) {
        await db.template.updateMany({
          where: { companyId: row.companyId, code: row.templateCode },
          data: { sentCount: { increment: 1 } },
        });
      }
    } catch (err) {
      const tries = row.tries + 1;
      const retry = !(err instanceof ChannelError && !err.retryable) && tries < MAX_TRIES;
      await db.outbox.update({
        where: { id: row.id },
        data: {
          status: retry ? 'QUEUED' : 'FAILED',
          tries,
          lastError: (err as Error).message.slice(0, 500),
          sendAfter: new Date(Date.now() + BASE_DELAY_MS * 2 ** (tries - 1)),
        },
      });
    }
  }
  return rows.length;
}
