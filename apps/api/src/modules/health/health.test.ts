import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asHeader, cookieHeader, makeApp, makeCompany, ORIGIN } from '../../test/helpers';
import { recordChange } from '../../lib/events';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx.app.close();
});

describe('health', () => {
  it('reports ok with the database up', async () => {
    const res = await ctx.app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('returns the error shape for unknown routes', async () => {
    const res = await ctx.app.inject({ url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('live events (SSE)', () => {
  it('streams committed events of my company only', async () => {
    const mine = await makeCompany(ctx.app);
    const other = await makeCompany(ctx.app);
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { identifier: mine.mobile, password: mine.password },
    });
    const cookie = asHeader(cookieHeader(login));
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const res = await fetch(`${address}/api/events`, { headers: { cookie }, signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil('event: ready');

    // Rolled-back events must never arrive; other companies' events must never arrive.
    await ctx.prisma
      .$transaction(async (tx) => {
        await recordChange(
          tx,
          { companyId: mine.company.id, actorId: null },
          {
            event: 'user.created',
            entityType: 'user',
            entityId: 'rolled-back',
          },
        );
        throw new Error('rollback');
      })
      .catch(() => undefined);
    await ctx.prisma.$transaction((tx) =>
      recordChange(
        tx,
        { companyId: other.company.id, actorId: null },
        {
          event: 'user.created',
          entityType: 'user',
          entityId: 'other-company',
        },
      ),
    );
    await ctx.prisma.$transaction((tx) =>
      recordChange(
        tx,
        { companyId: mine.company.id, actorId: null },
        {
          event: 'user.created',
          entityType: 'user',
          entityId: 'committed',
        },
      ),
    );
    await readUntil('committed');
    controller.abort();
    expect(text).toContain('"entityId":"committed"');
    expect(text).not.toContain('rolled-back');
    expect(text).not.toContain('other-company');
  });
});

describe('readiness and alerts', () => {
  it('says what is wrong in words, to admins only; a monitor outside gets one word and names', async () => {
    const { runChecks, overall } = await import('./checks');
    const db = ctx.prisma;
    const startedAt = new Date(Date.now() - 3_600_000);
    await db.opsMark.deleteMany({});
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    await db.opsMark.createMany({
      data: [
        { key: 'worker', ok: true, at: at(1) },
        { key: 'backup', ok: true, note: 'mono-db-x.dump (4.0M)', at: at(300) },
        { key: 'restore_test', ok: true, note: 'restored in 35s', at: at(2000) },
        { key: 'disk', ok: true, note: 'pg=41 backups=63 uploads=12', at: at(2) },
      ],
    });
    const fine = await runChecks(db, { uploadDir: '/nonexistent', production: true, startedAt });
    expect(fine.find((c) => c.key === 'worker')).toMatchObject({ state: 'ok' });
    expect(fine.find((c) => c.key === 'backup')).toMatchObject({ state: 'ok' });
    expect(fine.find((c) => c.key === 'disk')).toMatchObject({ state: 'ok', message: '63% full (backups)' });

    // The worker went quiet 10 minutes ago, the last backup failed, a disk is nearly full.
    await db.opsMark.update({ where: { key: 'worker' }, data: { at: at(10) } });
    await db.opsMark.update({
      where: { key: 'backup' },
      data: { ok: false, note: 'the dump could not be read back' },
    });
    await db.opsMark.update({ where: { key: 'disk' }, data: { note: 'pg=93 backups=63 uploads=12' } });
    const bad = await runChecks(db, { uploadDir: '/nonexistent', production: true, startedAt });
    expect(overall(bad)).toBe('failing');
    expect(
      bad
        .filter((c) => c.state === 'fail')
        .map((c) => c.key)
        .sort(),
    ).toEqual(['backup', 'disk', 'worker']);
    expect(bad.find((c) => c.key === 'worker')!.message).toMatch(/worker stopped/);
    expect(bad.find((c) => c.key === 'disk')!.message).toMatch(/^93% full \(database\)/);

    const outside = await ctx.app.inject({ url: '/api/health/ready' });
    expect(outside.statusCode).toBe(200);
    expect(outside.json().status).toMatch(/failing|degraded|ok/);
    expect(JSON.stringify(outside.json())).not.toMatch(/dump|%/); // names only, no details
    expect(outside.headers['cache-control']).toBe('no-store');
    expect((await ctx.app.inject({ url: '/api/system/health' })).statusCode).toBe(401);
    const { mobile, password } = await makeCompany(ctx.app);
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { identifier: mobile, password },
    });
    const admin = await ctx.app.inject({
      url: '/api/system/health',
      headers: { cookie: asHeader(cookieHeader(login)) },
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().checks.map((c: { key: string }) => c.key)).toContain('logArchive');
  });

  it('tells a problem once, not again while it lasts, and once more when it is over', async () => {
    const { watchHealth } = await import('./alerts');
    const { testEnv } = await import('../../test/helpers');
    const db = ctx.prisma;
    const log = { warn: () => undefined, info: () => undefined };
    const startedAt = new Date(Date.now() - 3_600_000);
    await db.opsMark.deleteMany({});
    await db.opsMark.create({ data: { key: 'worker', ok: true, at: new Date(Date.now() - 20 * 60_000) } });
    const env = testEnv({ NODE_ENV: 'production', BASE_URL: 'https://mono.example.com' });
    const first = await watchHealth(db, env, { startedAt, log });
    expect(first).toContain('worker');
    expect(await watchHealth(db, env, { startedAt, log })).not.toContain('worker');
    // Six hours on and still down: told again.
    const later = new Date(Date.now() + 7 * 3_600_000);
    expect(await watchHealth(db, env, { startedAt, log, now: later })).toContain('worker');
    // The worker is back.
    await db.opsMark.update({ where: { key: 'worker' }, data: { at: new Date() } });
    expect(await watchHealth(db, env, { startedAt, log })).toContain('worker (over)');
    expect(await watchHealth(db, env, { startedAt, log })).toEqual([]);
    await db.opsMark.deleteMany({});
  });
});
