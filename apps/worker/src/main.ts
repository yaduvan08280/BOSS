import { writeFile } from 'node:fs/promises';
import { PgBoss } from 'pg-boss';
import pino from 'pino';
import { createPrisma } from '@mono/db';
import { loadEnv } from '@mono/api/env';
import { EventListener } from '@mono/api/services';
import { dispatchPending, type HandlerRegistry } from './jobs/dispatch-events';

const env = loadEnv();
const log = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
}).child({ proc: 'worker' });

const prisma = createPrisma(env.DATABASE_URL);
const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
boss.on('error', (err) => log.error({ err }, 'pg-boss error'));

const handlers: HandlerRegistry = {};
const QUEUE_DISPATCH = 'events.dispatch';
const HEARTBEAT_FILE = '/tmp/mono-worker-alive';

await boss.start();
await boss.createQueue(QUEUE_DISPATCH, { policy: 'singleton' });

await boss.work(QUEUE_DISPATCH, async () => {
  while ((await dispatchPending(prisma, handlers)) > 0) {
    // keep draining until the outbox is empty
  }
});
// Safety net for events whose NOTIFY was missed (worker restarting, etc.).
await boss.schedule(QUEUE_DISPATCH, '* * * * *', null, { tz: 'UTC' });

// React to new events right away.
const listener = new EventListener(env.DATABASE_URL, log);
listener.on('event', () => {
  boss
    .send(QUEUE_DISPATCH, null, { singletonSeconds: 1 })
    .catch((err) => log.warn({ err }, 'enqueue failed'));
});
await listener.start();

// Docker healthcheck reads this file's age.
const beat = () => writeFile(HEARTBEAT_FILE, new Date().toISOString()).catch(() => undefined);
await beat();
const beatTimer = setInterval(beat, 30_000);

log.info('Worker started');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'Worker shutting down');
  clearInterval(beatTimer);
  await listener.stop();
  await boss.stop({ graceful: true, timeout: 20_000 });
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
