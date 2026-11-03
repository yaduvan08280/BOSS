import { writeFile } from 'node:fs/promises';
import { PgBoss } from 'pg-boss';
import pino from 'pino';
import { createPrisma } from '@mono/db';
import { loadEnv } from '@mono/api/env';
import {
  eaJobs,
  EventListener,
  expireChecklists,
  flagOverdueTasks,
  LocalDiskStorage,
  remindChecklists,
  remindUnaccepted,
  runFmsWebhooks,
  sendWeeklyMis,
  sweepChecklists,
  sweepSlips,
  sweepTickets,
  watchFmsSteps,
} from '@mono/api/services';
import { dispatchPending, type HandlerRegistry } from './jobs/dispatch-events';
import { notifyForEvent } from './notify/engine';
import { processEscalations } from './notify/escalations';
import { sendDue } from './notify/outbox';
import { BotManager } from './notify/telegram-bot';

const env = loadEnv();
const log = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
}).child({ proc: 'worker' });

const prisma = createPrisma(env.DATABASE_URL);
const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
boss.on('error', (err) => log.error({ err }, 'pg-boss error'));

const QUEUE_DISPATCH = 'events.dispatch';
const QUEUE_ESCALATIONS = 'notify.escalations';
const QUEUE_WORK_5MIN = 'work.every5min';
const QUEUE_WORK_1MIN = 'work.every1min';
const HEARTBEAT_FILE = '/tmp/mono-worker-alive';
const OUTBOX_POLL_MS = 10_000;

const storage = new LocalDiskStorage(env.UPLOAD_DIR);
const bots = new BotManager(prisma, env, storage, log);

// ---- Outbox: send as soon as something is queued, and poll for delayed / retried messages ----
let sending = false;
let again = false;
async function drainOutbox() {
  if (sending) {
    again = true;
    return;
  }
  sending = true;
  try {
    do {
      again = false;
      while ((await sendDue({ db: prisma, env, storage })) > 0) {
        // keep sending until nothing is due
      }
    } while (again);
  } catch (err) {
    log.error({ err }, 'Outbox send failed');
  } finally {
    sending = false;
  }
}

const handlers: HandlerRegistry = {
  '*': [
    async (event, db) => {
      await notifyForEvent(event, {
        db,
        appName: env.APP_NAME,
        baseUrl: env.BASE_URL,
        onQueued: () => void drainOutbox(),
      });
    },
  ],
  'channel.updated': [
    async (event) => {
      if ((event.payload as { channel?: string }).channel === 'telegram') await bots.sync();
    },
  ],
  'company.created': [async () => bots.sync()],
};

await boss.start();
await boss.createQueue(QUEUE_DISPATCH, { policy: 'singleton' });
await boss.createQueue(QUEUE_ESCALATIONS, { policy: 'singleton' });

await boss.work(QUEUE_DISPATCH, async () => {
  while ((await dispatchPending(prisma, handlers)) > 0) {
    // keep draining until the outbox of events is empty
  }
});
// Safety net for events whose NOTIFY was missed (worker restarting, etc.).
await boss.schedule(QUEUE_DISPATCH, '* * * * *', null, { tz: 'UTC' });

await boss.work(QUEUE_ESCALATIONS, async () => {
  const r = await processEscalations(prisma);
  if (r.escalated) log.info(r, 'Escalations sent');
});
await boss.schedule(QUEUE_ESCALATIONS, '* * * * *', null, { tz: 'UTC' });

// Every 5 minutes: checklist sweep, overdue tasks, late slips, ticket escalations.
// Every minute: checklist reminders and misses, the EA board's day and briefs, Monday's MIS.
await boss.createQueue(QUEUE_WORK_5MIN, { policy: 'singleton' });
await boss.createQueue(QUEUE_WORK_1MIN, { policy: 'singleton' });
await boss.work(QUEUE_WORK_5MIN, async () => {
  const created = await sweepChecklists(prisma);
  const overdue = await flagOverdueTasks(prisma);
  const unaccepted = await remindUnaccepted(prisma);
  const slips = await sweepSlips(prisma);
  const tickets = await sweepTickets(prisma);
  const fms = await watchFmsSteps(prisma);
  if (
    fms ||
    created ||
    overdue ||
    unaccepted ||
    slips.late ||
    slips.closed ||
    tickets.escalated ||
    tickets.closed
  )
    log.info({ created, overdue, unaccepted, slips, tickets, fms }, 'Work sweep');
});
await boss.work(QUEUE_WORK_1MIN, async () => {
  await remindChecklists(prisma);
  await expireChecklists(prisma);
  const briefs = await eaJobs(prisma);
  const mis = await sendWeeklyMis(prisma);
  await runFmsWebhooks(prisma);
  if (briefs || mis) log.info({ briefs, mis }, 'Scheduled sends');
});
await boss.schedule(QUEUE_WORK_5MIN, '*/5 * * * *', null, { tz: 'UTC' });
await boss.schedule(QUEUE_WORK_1MIN, '* * * * *', null, { tz: 'UTC' });
await boss.send(QUEUE_WORK_5MIN, null).catch(() => undefined);

// React to new events right away.
const listener = new EventListener(env.DATABASE_URL, log);
listener.on('event', () => {
  boss
    .send(QUEUE_DISPATCH, null, { singletonSeconds: 1 })
    .catch((err) => log.warn({ err }, 'enqueue failed'));
});
await listener.start();

const outboxTimer = setInterval(() => void drainOutbox(), OUTBOX_POLL_MS);
await bots.sync().catch((err) => log.error({ err }, 'Telegram bots could not start'));

// Docker healthcheck reads this file's age.
const beat = () => writeFile(HEARTBEAT_FILE, new Date().toISOString()).catch(() => undefined);
await beat();
const beatTimer = setInterval(beat, 30_000);

log.info('Worker started');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'Worker shutting down');
  clearInterval(beatTimer);
  clearInterval(outboxTimer);
  await bots.stop();
  await listener.stop();
  await boss.stop({ graceful: true, timeout: 20_000 });
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
