import { statfs } from 'node:fs/promises';
import type { Db } from '@mono/db';

export type Check = {
  key: string;
  /** ok — fine · warn — look at it soon · fail — something is not working (the owner is told). */
  state: 'ok' | 'warn' | 'fail';
  message: string;
};

const MIN = 60_000;
const ago = (at: Date, now: Date) => {
  const m = Math.round((now.getTime() - at.getTime()) / MIN);
  return m < 90
    ? `${m} min ago`
    : m < 48 * 60
      ? `${Math.round(m / 60)} h ago`
      : `${Math.round(m / 1440)} days ago`;
};

/**
 * Is the whole installation doing its job? Each check answers in plain words. Parts that are not installed
 * (no backup container on a developer's machine) answer "ok — not set up here" unless `production` is set.
 */
export async function runChecks(
  db: Db,
  opts: { uploadDir: string; production: boolean; startedAt: Date; now?: Date },
): Promise<Check[]> {
  const now = opts.now ?? new Date();
  const out: Check[] = [];
  const add = (key: string, state: Check['state'], message: string) => out.push({ key, state, message });
  try {
    await db.$queryRaw`SELECT 1`;
    add('database', 'ok', 'Answering');
  } catch {
    add('database', 'fail', 'The database does not answer');
    return out;
  }
  const marks = new Map((await db.opsMark.findMany()).map((m) => [m.key, m]));
  const young = now.getTime() - opts.startedAt.getTime() < 5 * MIN;

  // The worker says "alive" every minute.
  const worker = marks.get('worker');
  if (!worker) add('worker', young || !opts.production ? 'ok' : 'fail', 'No sign of the worker yet');
  else if (now.getTime() - worker.at.getTime() > 3 * MIN)
    add(
      'worker',
      'fail',
      `The worker stopped: last sign of life ${ago(worker.at, now)}. Reminders and messages are not going out.`,
    );
  else add('worker', 'ok', `Alive (${ago(worker.at, now)})`);

  // Work that is waiting to go out.
  const [stuckEvents, lateMessages, failedMessages] = await Promise.all([
    db.domainEvent.count({
      where: {
        dispatchedAt: null,
        attempts: { lt: 5 },
        occurredAt: { lt: new Date(now.getTime() - 5 * MIN) },
      },
    }),
    db.outbox.count({ where: { status: 'QUEUED', sendAfter: { lt: new Date(now.getTime() - 15 * MIN) } } }),
    db.outbox.groupBy({
      by: ['channel'],
      where: { status: 'FAILED', updatedAt: { gt: new Date(now.getTime() - 60 * MIN) } },
      _count: true,
    }),
  ]);
  if (stuckEvents > 200)
    add('queue', 'fail', `${stuckEvents} events have waited more than 5 minutes to be handled`);
  else if (lateMessages > 50) add('queue', 'fail', `${lateMessages} messages are more than 15 minutes late`);
  else
    add(
      'queue',
      stuckEvents || lateMessages ? 'warn' : 'ok',
      stuckEvents || lateMessages
        ? `${stuckEvents} events and ${lateMessages} messages are waiting`
        : 'Nothing waiting',
    );
  const failing = failedMessages.filter((f) => f._count >= 10);
  add(
    'channels',
    failing.length ? 'fail' : 'ok',
    failing.length
      ? `Sending keeps failing: ${failing.map((f) => `${f.channel} (${f._count} in the last hour)`).join(', ')}`
      : 'Messages are going out',
  );

  // Backups: the nightly one, the weekly restore test, the write-ahead log.
  const backup = marks.get('backup');
  if (!backup)
    add(
      'backup',
      opts.production && !young ? 'warn' : 'ok',
      'No backup has reported yet (the first one runs at night)',
    );
  else if (!backup.ok)
    add('backup', 'fail', `The last backup FAILED ${ago(backup.at, now)}: ${backup.note ?? ''}`);
  else if (now.getTime() - backup.at.getTime() > 26 * 60 * MIN)
    add('backup', 'fail', `The last good backup was ${ago(backup.at, now)} — it should run every night`);
  else add('backup', 'ok', `Last good backup ${ago(backup.at, now)}: ${backup.note ?? ''}`);
  const test = marks.get('restore_test');
  if (!test) add('restoreTest', 'ok', 'The weekly restore test has not run yet (Sunday 03:30)');
  else if (!test.ok)
    add('restoreTest', 'fail', `The restore test FAILED ${ago(test.at, now)}: ${test.note ?? ''}`);
  else if (now.getTime() - test.at.getTime() > 9 * 24 * 60 * MIN)
    add('restoreTest', 'warn', `The last restore test was ${ago(test.at, now)}`);
  else add('restoreTest', 'ok', `Passed ${ago(test.at, now)}: ${test.note ?? ''}`);
  const [archiver] = await db.$queryRaw<
    { mode: string; last_ok: Date | null; last_failed: Date | null; failed: bigint }[]
  >`SELECT current_setting('archive_mode') AS mode, last_archived_time AS last_ok,
           last_failed_time AS last_failed, failed_count AS failed FROM pg_stat_archiver`;
  if (!archiver || archiver.mode !== 'on')
    add('logArchive', opts.production ? 'warn' : 'ok', 'Minute-by-minute log archiving is off');
  else if (archiver.last_failed && (!archiver.last_ok || archiver.last_failed > archiver.last_ok))
    add(
      'logArchive',
      'fail',
      `The database cannot hand over its log pieces (failing since ${ago(archiver.last_failed, now)}): its disk will fill`,
    );
  else add('logArchive', 'ok', archiver.last_ok ? `Last piece saved ${ago(archiver.last_ok, now)}` : 'On');

  // Disks: what the backup container measured, and the uploads folder as this process sees it.
  const worst: { name: string; pct: number }[] = [];
  const disk = marks.get('disk');
  for (const part of (disk?.note ?? '').split(' ')) {
    const [name, pct] = part.split('=');
    if (name && pct && Number(pct) > 0)
      worst.push({ name: name === 'pg' ? 'database' : name, pct: Number(pct) });
  }
  try {
    const fs = await statfs(opts.uploadDir);
    if (fs.blocks)
      worst.push({ name: 'uploads', pct: Math.round(100 - (Number(fs.bavail) / Number(fs.blocks)) * 100) });
  } catch {
    /* the folder is made on the first upload */
  }
  const fullest = worst.sort((a, b) => b.pct - a.pct)[0];
  if (!fullest) add('disk', 'ok', 'Not measured here');
  else
    add(
      'disk',
      fullest.pct >= 90 ? 'fail' : fullest.pct >= 80 ? 'warn' : 'ok',
      `${fullest.pct}% full (${fullest.name})${fullest.pct >= 80 ? ' — free some space or add a disk' : ''}`,
    );

  // Errors: many more in the last quarter of an hour than usual.
  const [recent, hour] = await Promise.all([
    db.errorEvent.count({ where: { lastAt: { gt: new Date(now.getTime() - 15 * MIN) } } }),
    db.errorEvent.count({
      where: { lastAt: { gt: new Date(now.getTime() - 75 * MIN), lte: new Date(now.getTime() - 15 * MIN) } },
    }),
  ]);
  add(
    'errors',
    recent >= 20 && recent > hour ? 'fail' : 'ok',
    recent >= 20 && recent > hour
      ? `${recent} different errors in the last 15 minutes (System Master → Errors)`
      : `${recent} in the last 15 minutes`,
  );
  return out;
}

/** The one-word answer: ok, degraded (something to look at) or failing. */
export const overall = (checks: Check[]) =>
  checks.some((c) => c.state === 'fail')
    ? 'failing'
    : checks.some((c) => c.state === 'warn')
      ? 'degraded'
      : 'ok';
