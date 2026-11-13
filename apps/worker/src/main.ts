import { writeFile } from 'node:fs/promises';
import { PgBoss } from 'pg-boss';
import pino from 'pino';
import { createPrisma } from '@mono/db';
import { loadEnv } from '@mono/api/env';
import {
  aiFollowUpText,
  eaJobs,
  expireBuddyRequests,
  imsSweep,
  crmSweep,
  morningCoverReport,
  recordError,
  DriveAwareStorage,
  driveEnvOf,
  runReportBackfills,
  sendScheduledReports,
  syncDrive,
  netOf,
  queueWebhooks,
  sendWebhooks,
  runCovers,
  applyBranchMoves,
  carryOverCrm,
  sendQueuedPrints,
  reservationSweep,
  hotelSweep,
  retryPushes,
  flashSweep,
  connectNet,
  complianceSweep,
  watchRenewals,
  settleAttendance,
  watchAbsences,
  EventListener,
  expireChecklists,
  flagOverdueTasks,
  LocalDiskStorage,
  remindChecklists,
  remindUnaccepted,
  runFmsWebhooks,
  sendDailySummaries,
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
/** Log a worker error and keep it in System Master → Errors. */
const report = (where: string) => (err: unknown) => {
  log.error({ err }, where);
  const e = err instanceof Error ? err : new Error(String(err));
  void recordError(prisma, { source: 'worker', message: e.message, stack: e.stack ?? null, path: where });
};
/** A job body whose errors are reported, then passed on so pg-boss retries it. */
const watched = (where: string, fn: () => Promise<void>) => async () => {
  try {
    await fn();
  } catch (err) {
    report(where)(err);
    throw err;
  }
};
boss.on('error', report('pg-boss error'));

const QUEUE_DISPATCH = 'events.dispatch';
const QUEUE_ESCALATIONS = 'notify.escalations';
const QUEUE_WORK_5MIN = 'work.every5min';
const QUEUE_WORK_1MIN = 'work.every1min';
const HEARTBEAT_FILE = '/tmp/mono-worker-alive';
const OUTBOX_POLL_MS = 10_000;

const disk = new LocalDiskStorage(env.UPLOAD_DIR);
const storage = new DriveAwareStorage(disk, prisma, driveEnvOf(env));
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
    report('Outbox send failed')(err);
  } finally {
    sending = false;
  }
}

// ---- Outgoing webhooks (public API): queued per event, sent at once and retried every minute ----
const net = netOf(env);
let hooking = false;
async function drainWebhooks() {
  if (hooking) return;
  hooking = true;
  try {
    await sendWebhooks(prisma, net);
  } catch (err) {
    report('Webhook send failed')(err);
  } finally {
    hooking = false;
  }
}

const handlers: HandlerRegistry = {
  '*': [
    async (event, db) => {
      if (await queueWebhooks(db, event)) setImmediate(() => void drainWebhooks());
    },
    async (event, db) => {
      await notifyForEvent(event, {
        db,
        appName: env.APP_NAME,
        baseUrl: env.BASE_URL,
        onQueued: () => void drainOutbox(),
        aiWriter: (companyId, input) => aiFollowUpText(db, env.APP_SECRET, companyId, input),
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

await boss.work(
  QUEUE_DISPATCH,
  watched(QUEUE_DISPATCH, async () => {
    while ((await dispatchPending(prisma, handlers)) > 0) {
      // keep draining until the outbox of events is empty
    }
  }),
);
// Safety net for events whose NOTIFY was missed (worker restarting, etc.).
await boss.schedule(QUEUE_DISPATCH, '* * * * *', null, { tz: 'UTC' });

await boss.work(
  QUEUE_ESCALATIONS,
  watched(QUEUE_ESCALATIONS, async () => {
    const r = await processEscalations(prisma);
    if (r.escalated) log.info(r, 'Escalations sent');
  }),
);
await boss.schedule(QUEUE_ESCALATIONS, '* * * * *', null, { tz: 'UTC' });

// Every 5 minutes: checklist sweep, overdue tasks, late slips, ticket escalations.
// Every minute: checklist reminders and misses, the EA board's day and briefs, Monday's MIS, the AI summary.
await boss.createQueue(QUEUE_WORK_5MIN, { policy: 'singleton' });
await boss.createQueue(QUEUE_WORK_1MIN, { policy: 'singleton' });
await boss.work(
  QUEUE_WORK_5MIN,
  watched(QUEUE_WORK_5MIN, async () => {
    const created = await sweepChecklists(prisma);
    const overdue = await flagOverdueTasks(prisma);
    const unaccepted = await remindUnaccepted(prisma);
    const slips = await sweepSlips(prisma);
    const tickets = await sweepTickets(prisma);
    const fms = await watchFmsSteps(prisma);
    // HR: Buddy answers that ran out, covers starting and ending, absences, and settling attendance.
    const buddies = await expireBuddyRequests(prisma);
    const covers = await runCovers(prisma);
    const absent = await watchAbsences(prisma);
    // People whose move to another branch takes effect today switch over.
    // Licences and franchise agreements about to run out (told 30 and 7 days before, and on the day).
    const renewals = await watchRenewals(prisma);
    if (renewals) log.info({ renewals }, 'Renewal reminders');
    const moved = await applyBranchMoves(prisma);
    if (moved) log.info({ moved }, 'Branch moves applied');
    const settled = await settleAttendance(prisma);
    if (buddies || covers.started || covers.ended || absent || settled)
      log.info({ buddies, covers, absent, settled }, 'HR sweep');
    // Inventory: daily snapshots and bands, the morning MAX review, audit cycles, the order list, dead stock.
    await imsSweep(prisma);
    // Sales CRM: orders done, the day's calls, stuck leads, customers going quiet.
    // Money core: orders and payments from before the bill engine get their papers (nothing once caught up).
    const carried = await carryOverCrm(prisma);
    if (carried) log.info({ carried }, 'CRM orders and payments carried into bills');
    // Hotels: group blocks past their release date, Form C reminders, rooms whose maintenance ticket closed.
    const hotels = await hotelSweep(prisma);
    if (hotels.released || hotels.formC || hotels.rooms) log.info({ hotels }, 'Hotel sweep');
    // Compliance: licences and duties about to run out are told at each step, once.
    const licences = await complianceSweep(prisma);
    if (licences) log.info({ licences }, 'Compliance reminders');
    // Integrations: availability pushes the channel manager did not take are tried again.
    const pushes = await retryPushes(prisma, connectNet(env));
    if (pushes) log.info({ pushes }, 'Channel pushes sent again');
    // Hospitality: yesterday's flash report to the owner, once, from 08:00.
    const flashes = await flashSweep(prisma);
    if (flashes) log.info({ flashes }, 'Flash reports sent');
    const crmCalls = await crmSweep(prisma);
    if (crmCalls) log.info({ crmCalls }, 'CRM calls made');
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
  }),
);
await boss.work(
  QUEUE_WORK_1MIN,
  watched(QUEUE_WORK_1MIN, async () => {
    await remindChecklists(prisma);
    // POS: kitchen tickets and bills that have not reached their network printer yet are tried again.
    await sendQueuedPrints(prisma);
    // Reservations: reminders, no-shows once the hold time has passed, requests nobody confirmed.
    const bookings = await reservationSweep(prisma);
    if (bookings.reminded || bookings.noShows || bookings.lapsed) log.info({ bookings }, 'Reservations');
    await expireChecklists(prisma);
    const briefs = await eaJobs(prisma);
    const mis = await sendWeeklyMis(prisma);
    const summaries = await sendDailySummaries(prisma, env.APP_SECRET);
    await morningCoverReport(prisma);
    await runFmsWebhooks(prisma, fetch, net);
    await drainWebhooks();
    const reports = await sendScheduledReports(prisma);
    if (reports) log.info({ reports }, 'Scheduled reports sent');
    const copies = await runReportBackfills(prisma);
    if (copies) log.info({ copies }, 'Reportable values copied');
    const toDrive = await syncDrive(prisma, driveEnvOf(env), disk);
    if (toDrive) log.info({ toDrive }, 'Files moved to Google Drive');
    if (briefs || mis || summaries) log.info({ briefs, mis, summaries }, 'Scheduled sends');
  }),
);
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
await bots.sync().catch(report('Telegram bots could not start'));

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
