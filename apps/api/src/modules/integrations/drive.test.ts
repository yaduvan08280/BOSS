import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from '../../lib/storage';
import { makeApp, ownerClient } from '../../test/helpers';
import { actorFor } from '../work/actor';
import { DRIVE_SCOPE, finishDrive, forgetToken, startDrive, type DriveEnv } from './drive';
import { DriveAwareStorage, syncDrive } from './drive-files';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const CLIENT = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';

/** A small fake of Google's token, about, files and upload endpoints. */
function fakeGoogle() {
  const files = new Map<string, Buffer>();
  const calls: string[] = [];
  let n = 0;
  const f = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push(`${init.method ?? 'GET'} ${url.split('?')[0]}`);
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const p = new URLSearchParams(String(init.body));
      if (p.get('grant_type') === 'authorization_code')
        return p.get('code') === 'good'
          ? json({ access_token: 'at1', refresh_token: 'rt1', scope: DRIVE_SCOPE, expires_in: 3600 })
          : json({ error: 'invalid_grant' }, 400);
      return p.get('refresh_token') === 'rt1'
        ? json({ access_token: 'at2', expires_in: 3600 })
        : json({ error: 'invalid_grant' }, 400);
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/about'))
      return json({ user: { emailAddress: 'owner@ggminerals.example' } });
    if (url.startsWith('https://www.googleapis.com/drive/v3/files') && init.method === 'POST')
      return json({ id: 'folder1' });
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const body = Buffer.from(init.body as Uint8Array);
      const text = body.toString('latin1');
      const start = text.indexOf('\r\n\r\n', text.indexOf('Content-Type', text.indexOf('}'))) + 4;
      const end = text.lastIndexOf('\r\n--');
      const data = body.subarray(start, end);
      const id = `file${++n}`;
      files.set(id, data);
      return json({ id, size: String(data.length) });
    }
    const m = /drive\/v3\/files\/([^?]+)\?alt=media/.exec(url);
    if (m && files.has(m[1]!)) return new Response(new Uint8Array(files.get(m[1]!)!), { status: 200 });
    return json({ error: { message: 'not found' } }, 404);
  }) as unknown as typeof fetch;
  return { f, files, calls };
}

describe('Google Drive', () => {
  it('only the owner connects; the state must match; files then move to the Drive folder and still open', async () => {
    const o = await ownerClient(ctx.app);
    const google = fakeGoogle();
    const env: DriveEnv = {
      secret: 'test-secret-that-is-long-enough-1234567890',
      baseUrl: 'https://mono.example.com',
      appName: 'MONO',
      fetch: google.f,
    };
    const ownerId = (
      await ctx.prisma.user.findFirstOrThrow({ where: { companyId: o.company.id, role: { key: 'OWNER' } } })
    ).id;
    const owner = (await actorFor(ctx.prisma, o.company.id, ownerId))!;

    // The route checks the Client ID shape and who is asking.
    expect(
      (
        await o.api.post('/api/integrations/google-drive/start', {
          clientId: 'nope',
          clientSecret: 'GOCSPX-secret123',
        })
      ).status,
    ).toBe(400);
    await expect(
      startDrive(ctx.prisma, { ...owner, userId: 'someone-else', permissions: ['core.admin'] }, env, {
        clientId: CLIENT,
        clientSecret: 'GOCSPX-secret123',
      }),
    ).rejects.toThrow(/owner/);

    const { url } = await startDrive(ctx.prisma, owner, env, {
      clientId: CLIENT,
      clientSecret: 'GOCSPX-secret123',
    });
    const u = new URL(url);
    expect(u.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://mono.example.com/api/integrations/google-drive/callback',
    );
    expect(u.searchParams.get('access_type')).toBe('offline');
    const state = u.searchParams.get('state')!;
    const row = await ctx.prisma.driveConnection.findUniqueOrThrow({ where: { companyId: o.company.id } });
    expect(row.secrets).not.toContain('GOCSPX');

    expect(await finishDrive(ctx.prisma, owner, env, { code: 'good', state: 'wrong' })).toContain(
      'drive=expired',
    );
    expect(await finishDrive(ctx.prisma, owner, env, { code: 'good', state })).toContain('drive=connected');
    // The state is used once.
    expect(await finishDrive(ctx.prisma, owner, env, { code: 'good', state })).toContain('drive=expired');
    const c = await ctx.prisma.driveConnection.findUniqueOrThrow({ where: { companyId: o.company.id } });
    expect(c).toMatchObject({
      status: 'connected',
      accountEmail: 'owner@ggminerals.example',
      folderId: 'folder1',
    });
    const status = (await o.api.get('/api/integrations/google-drive')).body;
    expect(status).toMatchObject({ status: 'connected', folderName: 'MONO Files', canSetUp: true });

    // An older file stays on the server; a new one moves to Drive and opens from there.
    const dir = await mkdtemp(join(tmpdir(), 'mono-drive-'));
    const disk = new LocalDiskStorage(dir);
    const storage = new DriveAwareStorage(disk, ctx.prisma, env);
    const add = async (name: string, text: string, createdAt: Date) => {
      const path = `${o.company.id}/${name}`;
      await disk.put(path, Readable.from([Buffer.from(text)]));
      return ctx.prisma.attachment.create({
        data: {
          companyId: o.company.id,
          entityType: 'task',
          entityId: 'x',
          path,
          mime: 'application/pdf',
          size: text.length,
          originalName: name,
          createdAt,
        },
      });
    };
    const old = await add('old.pdf', 'old file', new Date(c.connectedAt!.getTime() - 3600_000));
    const fresh = await add(
      'invoice.pdf',
      '%PDF-1.4 invoice body',
      new Date(c.connectedAt!.getTime() + 1000),
    );
    forgetToken(o.company.id);
    expect(await syncDrive(ctx.prisma, env, disk, new Date(Date.now() + 5 * 60_000))).toBeGreaterThanOrEqual(
      1,
    );
    const moved = await ctx.prisma.attachment.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(moved.driveFileId).toBe('file1');
    expect(disk.has(fresh.path)).toBe(false);
    expect((await ctx.prisma.attachment.findUniqueOrThrow({ where: { id: old.id } })).driveFileId).toBeNull();
    const chunks: Buffer[] = [];
    for await (const ch of storage.get(fresh.path)) chunks.push(Buffer.from(ch as Uint8Array));
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-1.4 invoice body');

    // Google refusing the saved sign-in marks the connection as needing attention.
    const failing: DriveEnv = {
      ...env,
      fetch: (async () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as unknown as typeof fetch,
    };
    forgetToken(o.company.id);
    await add('later.pdf', 'later', new Date(Date.now()));
    await syncDrive(ctx.prisma, failing, disk, new Date(Date.now() + 5 * 60_000));
    expect(
      (await ctx.prisma.driveConnection.findUniqueOrThrow({ where: { companyId: o.company.id } })).status,
    ).toBe('error');
  });
});
