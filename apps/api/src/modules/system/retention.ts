import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Db } from '@mono/db';
import { sweepThrottles } from '../auth/throttle';

const DAY = 86_400_000;

/**
 * How long the tables that only ever grow keep their rows (days). These are records of something that
 * already happened and is kept elsewhere too (a sent message, a delivered event, a printed ticket) — never
 * work, money, stock or people. The audit log is not deleted at all: old rows move to files (below).
 */
export const KEEP_DAYS = {
  /** Messages that were sent, skipped or gave up. */
  outbox: 90,
  /** Read notifications; unread ones are kept a year. */
  notificationsRead: 180,
  notificationsUnread: 365,
  /** Events every listener has already seen. */
  domainEvents: 180,
  /** Calls to outside services that finished. */
  syncLogs: 90,
  /** Tickets and bills that were printed (or gave up). */
  printJobs: 30,
  /** Webhook calls that were delivered (or gave up). */
  webhookDeliveries: 90,
  /** Errors fixed, or not seen again, for this long. */
  errorEvents: 180,
  /** Sessions that ended (signed out, replaced or run out). */
  sessions: 30,
  /** Audit rows older than this move to the archive files (three years on the screens). 0 = never. */
  audit: 1095,
} as const;

const BATCH = 5000;
/** At most this many batches per table per run, so one run never holds the database for long. */
const MAX_BATCHES = 40;

type Finder = (take: number) => Promise<{ id: string }[]>;
type Remover = (ids: string[]) => Promise<unknown>;

/** Delete in small batches (each its own short statement), oldest first, until nothing old is left. */
async function trim(find: Finder, remove: Remover) {
  let gone = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = await find(BATCH);
    if (!rows.length) break;
    await remove(rows.map((r) => r.id));
    gone += rows.length;
    if (rows.length < BATCH) break;
  }
  return gone;
}

/**
 * The daily clean-up (worker). Safe to run twice and safe to stop in the middle: every step only removes rows
 * that are already old, and the audit archive writes a file before it deletes what the file holds.
 */
export async function runRetention(
  db: Db,
  opts: { uploadDir: string; now?: Date; keep?: Partial<typeof KEEP_DAYS> },
) {
  const now = opts.now ?? new Date();
  const keep = { ...KEEP_DAYS, ...opts.keep };
  const before = (days: number) => new Date(now.getTime() - days * DAY);
  const out: Record<string, number> = {};

  out.outbox = await trim(
    (take) =>
      db.outbox.findMany({
        where: {
          status: { in: ['SENT', 'DELIVERED', 'READ', 'SKIPPED', 'FAILED'] },
          createdAt: { lt: before(keep.outbox) },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take,
      }),
    (ids) => db.outbox.deleteMany({ where: { id: { in: ids } } }),
  );
  out.notifications = await trim(
    (take) =>
      db.notification.findMany({
        where: {
          OR: [
            { readAt: { not: null }, createdAt: { lt: before(keep.notificationsRead) } },
            { createdAt: { lt: before(keep.notificationsUnread) } },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take,
      }),
    (ids) => db.notification.deleteMany({ where: { id: { in: ids } } }),
  );
  out.domainEvents = await trim(
    (take) =>
      db.domainEvent.findMany({
        where: { dispatchedAt: { not: null }, occurredAt: { lt: before(keep.domainEvents) } },
        select: { id: true },
        orderBy: { occurredAt: 'asc' },
        take,
      }),
    (ids) => db.domainEvent.deleteMany({ where: { id: { in: ids } } }),
  );
  out.syncLogs = await trim(
    (take) =>
      db.syncLog.findMany({
        where: { status: { in: ['OK', 'FAILED'] }, createdAt: { lt: before(keep.syncLogs) } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take,
      }),
    (ids) => db.syncLog.deleteMany({ where: { id: { in: ids } } }),
  );
  out.printJobs = await trim(
    (take) =>
      db.printJob.findMany({
        where: { status: { in: ['SENT', 'FAILED'] }, createdAt: { lt: before(keep.printJobs) } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take,
      }),
    (ids) => db.printJob.deleteMany({ where: { id: { in: ids } } }),
  );
  out.webhookDeliveries = await trim(
    (take) =>
      db.webhookDelivery.findMany({
        where: { status: { in: ['SENT', 'FAILED'] }, createdAt: { lt: before(keep.webhookDeliveries) } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take,
      }),
    (ids) => db.webhookDelivery.deleteMany({ where: { id: { in: ids } } }),
  );
  out.errorEvents = await trim(
    (take) =>
      db.errorEvent.findMany({
        where: { lastAt: { lt: before(keep.errorEvents) } },
        select: { id: true },
        orderBy: { lastAt: 'asc' },
        take,
      }),
    (ids) => db.errorEvent.deleteMany({ where: { id: { in: ids } } }),
  );
  out.sessions = await trim(
    (take) =>
      db.session.findMany({
        where: {
          OR: [{ revokedAt: { lt: before(keep.sessions) } }, { expiresAt: { lt: before(keep.sessions) } }],
        },
        select: { id: true },
        take,
      }),
    (ids) => db.session.deleteMany({ where: { id: { in: ids } } }),
  );
  out.loginThrottles = await sweepThrottles(db, now);
  out.auditArchived = keep.audit > 0 ? await archiveAudit(db, opts.uploadDir, before(keep.audit)) : 0;
  return out;
}

/**
 * Audit rows older than the cut-off leave the table for a file per company and month
 * (`<uploads>/_archive/audit/<company>/<YYYY-MM>.jsonl.gz`, one JSON row per line; the uploads folder is in
 * every backup). Nothing is lost: a batch is written and flushed to disk first, and only then deleted. A stop
 * between the two leaves the batch in both places — the next run writes it again (each line carries its id).
 */
export async function archiveAudit(db: Db, uploadDir: string, cutoff: Date) {
  let moved = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = await db.auditLog.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    if (!rows.length) break;
    const files = new Map<string, string[]>();
    for (const r of rows) {
      const file = join(
        uploadDir,
        '_archive',
        'audit',
        r.companyId,
        `${r.createdAt.toISOString().slice(0, 7)}.jsonl.gz`,
      );
      files.set(file, [...(files.get(file) ?? []), JSON.stringify(r)]);
    }
    for (const [file, lines] of files) {
      await mkdir(join(file, '..'), { recursive: true });
      // A gzip file may be several gzip parts one after another: appending a part keeps it a valid file.
      const handle = await open(file, 'a');
      try {
        await handle.appendFile(gzipSync(`${lines.join('\n')}\n`));
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    await db.auditLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    moved += rows.length;
    if (rows.length < BATCH) break;
  }
  return moved;
}
