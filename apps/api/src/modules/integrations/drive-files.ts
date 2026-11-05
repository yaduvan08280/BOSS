import { randomBytes } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import type { ReadableStream as WebStream } from 'node:stream/web';
import type { Db } from '@mono/db';
import type { LocalDiskStorage, Storage } from '../../lib/storage';
import { accessToken, GOOGLE, type DriveEnv } from './drive';

/**
 * Files in the company's Drive (CLAUDE.md §12): new uploads are saved on the server first (so an upload never
 * waits on Google), then the worker moves them to the "{APP} Files" folder and frees the server copy. Files from
 * before the connection stay where they are. Reading looks on the server first, then in Drive.
 */
export class DriveAwareStorage implements Storage {
  constructor(
    private readonly local: LocalDiskStorage,
    private readonly db: Db,
    private readonly env: DriveEnv,
  ) {}

  put(key: string, body: Readable) {
    return this.local.put(key, body);
  }
  remove(key: string) {
    return this.local.remove(key);
  }
  get(key: string): Readable {
    if (this.local.has(key)) return this.local.get(key);
    const out = new PassThrough();
    void this.fromDrive(key).then(
      (s) => s.pipe(out),
      (e: Error) => out.destroy(e),
    );
    return out;
  }

  private async fromDrive(key: string) {
    const a = await this.db.attachment.findFirst({ where: { path: key, driveFileId: { not: null } } });
    if (!a) throw new Error('File not found');
    const token = await accessToken(this.db, this.env, a.companyId);
    const res = await (this.env.fetch ?? fetch)(`${GOOGLE.files}/${a.driveFileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok || !res.body) throw new Error(`Google Drive: HTTP ${res.status}`);
    return Readable.fromWeb(res.body as WebStream);
  }
}

/** Worker, every minute: move new files of connected companies to Drive (20 at a time per company). */
export async function syncDrive(db: Db, env: DriveEnv, local: LocalDiskStorage, now = new Date()) {
  const conns = await db.driveConnection.findMany({
    where: { status: 'connected', folderId: { not: null } },
  });
  let moved = 0;
  for (const c of conns) {
    const files = await db.attachment.findMany({
      where: {
        companyId: c.companyId,
        driveFileId: null,
        deletedAt: null,
        createdAt: { gte: c.connectedAt ?? now, lte: new Date(now.getTime() - 60_000) },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    for (const a of files) {
      if (!local.has(a.path)) continue;
      try {
        const token = await accessToken(db, env, c.companyId);
        const chunks: Buffer[] = [];
        for await (const ch of local.get(a.path)) chunks.push(Buffer.from(ch as Uint8Array));
        const data = Buffer.concat(chunks);
        const boundary = `mono${randomBytes(8).toString('hex')}`;
        const meta = JSON.stringify({
          name: `${a.createdAt.toISOString().slice(0, 10)} ${a.originalName}`,
          parents: [c.folderId],
          appProperties: { monoId: a.id },
        });
        const body = Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${a.mime}\r\n\r\n`,
          ),
          data,
          Buffer.from(`\r\n--${boundary}--`),
        ]);
        const res = await (env.fetch ?? fetch)(`${GOOGLE.upload}?uploadType=multipart&fields=id,size`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
          signal: AbortSignal.timeout(120_000),
        });
        const out = (await res.json().catch(() => ({}))) as {
          id?: string;
          size?: string;
          error?: { message?: string };
        };
        if (!res.ok || !out.id) throw new Error(out.error?.message ?? `HTTP ${res.status}`);
        if (out.size && Number(out.size) !== data.length) throw new Error('Drive kept a different size');
        await db.attachment.update({ where: { id: a.id }, data: { driveFileId: out.id } });
        await local.remove(a.path);
        moved++;
      } catch (e) {
        await db.driveConnection.update({
          where: { id: c.id },
          data: { lastError: `Upload of ${a.originalName}: ${(e as Error).message}`.slice(0, 300) },
        });
        break; // try this company again next minute
      }
    }
  }
  return moved;
}
