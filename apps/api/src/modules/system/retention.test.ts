import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, makeCompany } from '../../test/helpers';
import { runRetention } from './retention';

describe('the daily clean-up', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let dir: string;
  beforeAll(async () => {
    ctx = await makeApp();
    dir = await mkdtemp(join(tmpdir(), 'mono-archive-'));
  });
  afterAll(async () => {
    await ctx.app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

  it('removes what is old and finished, keeps what is recent or still waiting, and never loses an audit row', async () => {
    const db = ctx.prisma;
    const { company, owner } = await makeCompany(ctx.app);
    const c = { companyId: company.id };
    const outbox = (status: string, days: number) =>
      db.outbox.create({
        data: { ...c, channel: 'email', to: 'x@example.com', payload: {}, status, createdAt: ago(days) },
      });
    const oldSent = await outbox('SENT', 120);
    const oldWaiting = await outbox('QUEUED', 120);
    const newSent = await outbox('SENT', 5);
    const note = (days: number, read: boolean) =>
      db.notification.create({
        data: { ...c, userId: owner.id, title: 'n', createdAt: ago(days), readAt: read ? ago(days) : null },
      });
    const oldRead = await note(200, true);
    const oldUnread = await note(200, false);
    const veryOldUnread = await note(400, false);
    const event = (days: number, dispatched: boolean) =>
      db.domainEvent.create({
        data: {
          ...c,
          name: 'notify.test',
          entityType: 'user',
          entityId: owner.id,
          payload: {},
          occurredAt: ago(days),
          dispatchedAt: dispatched ? ago(days) : null,
        },
      });
    const oldSeen = await event(200, true);
    const oldUnseen = await event(200, false);
    const session = (over: object) =>
      db.session.create({
        data: { ...c, userId: owner.id, tokenHash: `r-${Math.random()}`, expiresAt: ago(-10), ...over },
      });
    const ended = await session({ revokedAt: ago(40) });
    const live = await session({});
    const audit = (days: number, action: string) =>
      db.auditLog.create({
        data: {
          ...c,
          actorId: owner.id,
          action,
          entityType: 'test',
          entityId: 'x',
          after: { n: days },
          createdAt: ago(days),
        },
      });
    const ancient = await audit(1200, 'ancient.change');
    const recent = await audit(30, 'recent.change');

    const first = await runRetention(db, { uploadDir: dir });
    expect(first.outbox).toBeGreaterThanOrEqual(1);
    expect(first.auditArchived).toBeGreaterThanOrEqual(1);
    const there = async (
      table: 'outbox' | 'notification' | 'domainEvent' | 'session' | 'auditLog',
      id: string,
    ) =>
      Boolean(
        await (db[table] as { findUnique: (a: object) => Promise<unknown> }).findUnique({ where: { id } }),
      );
    expect(await there('outbox', oldSent.id)).toBe(false);
    expect(await there('outbox', oldWaiting.id)).toBe(true); // not sent yet: never removed
    expect(await there('outbox', newSent.id)).toBe(true);
    expect(await there('notification', oldRead.id)).toBe(false);
    expect(await there('notification', oldUnread.id)).toBe(true); // unread: kept a year
    expect(await there('notification', veryOldUnread.id)).toBe(false);
    expect(await there('domainEvent', oldSeen.id)).toBe(false);
    expect(await there('domainEvent', oldUnseen.id)).toBe(true); // not delivered yet: never removed
    expect(await there('session', ended.id)).toBe(false);
    expect(await there('session', live.id)).toBe(true);
    expect(await there('auditLog', recent.id)).toBe(true);

    // The old audit row left the table for a file — whole, in its company's folder, by month.
    expect(await there('auditLog', ancient.id)).toBe(false);
    const folder = join(dir, '_archive', 'audit', company.id);
    const [file] = await readdir(folder);
    expect(file).toBe(`${ancient.createdAt.toISOString().slice(0, 7)}.jsonl.gz`);
    const lines = gunzipSync(await readFile(join(folder, file!)))
      .toString()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: ancient.id, action: 'ancient.change', after: { n: 1200 } });

    // A second batch for the same month is added to the same file, and the file still opens.
    const another = await audit(1200, 'ancient.second');
    await runRetention(db, { uploadDir: dir });
    const both = gunzipSync(await readFile(join(folder, file!)))
      .toString()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).id);
    expect(both).toEqual([ancient.id, another.id]);

    // Running it again finds nothing of this company to do.
    await runRetention(db, { uploadDir: dir });
    expect(await there('outbox', oldWaiting.id)).toBe(true);
    expect(
      await db.auditLog.count({ where: { companyId: company.id, action: { startsWith: 'ancient.' } } }),
    ).toBe(0);
  });
});
