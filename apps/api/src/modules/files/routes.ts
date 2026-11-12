import multipart from '@fastify/multipart';
import { createId } from '@paralleldrive/cuid2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors';
import type { Storage } from '../../lib/storage';
import { actorOf } from '../delegation/routes';
import { assertRecordFile } from '../records/detail';
import { looksLike } from './sniff';

/** Images, documents and voice notes. SVG/HTML are refused (they could run scripts when opened). */
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'video/mp4': 'mp4',
};
const MAX_BYTES = 10 * 1024 * 1024;

/** Upload and download files. Uploads are linked to a record (task, checklist item …) when that record is saved. */
export async function fileRoutes(app: FastifyInstance, opts: { storage: Storage }) {
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });

  app.post('/api/files', { onRequest: [app.authenticate], schema: { tags: ['files'] } }, async (request) => {
    const file = await request.file();
    if (!file) throw new AppError(400, 'BAD_REQUEST', 'Attach a file');
    const mime = file.mimetype.split(';')[0]!.trim();
    const ext = TYPES[mime];
    if (!ext) throw new AppError(400, 'BAD_REQUEST', 'Use a photo, PDF, Excel/Word file or a voice note');
    const auth = request.auth!;
    const id = createId();
    const now = new Date();
    const path = `${auth.companyId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${ext}`;
    const size = await opts.storage.put(path, file.file);
    if (file.file.truncated) {
      await opts.storage.remove(path);
      throw new AppError(400, 'BAD_REQUEST', 'The file is larger than 10 MB');
    }
    // The content must match the claimed type (first 1 KB), so a renamed program or web page is refused.
    let head = Buffer.alloc(0);
    for await (const c of opts.storage.get(path)) {
      head = Buffer.concat([head, Buffer.from(c as Uint8Array)]);
      if (head.length >= 1024) break;
    }
    if (!size || !looksLike(mime, head)) {
      await opts.storage.remove(path);
      throw new AppError(
        400,
        'BAD_REQUEST',
        "This file isn't what its name says. Use a photo, PDF, Excel/Word file or a voice note",
      );
    }
    const row = await request.db.attachment.create({
      data: {
        id,
        companyId: auth.companyId,
        entityType: 'upload',
        entityId: auth.userId,
        path,
        mime,
        size,
        originalName: file.filename.slice(0, 200),
        uploadedById: auth.userId,
      },
    });
    return { id: row.id, url: `/api/files/${row.id}`, mime: row.mime, size: row.size };
  });

  app.get(
    '/api/files/:id',
    { onRequest: [app.authenticate], schema: { tags: ['files'], params: z.object({ id: z.string() }) } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = await request.db.attachment.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw notFound('File');
      // A file of a custom record follows that record type's own permissions.
      if (row.entityType === 'record') await assertRecordFile(app.prisma, actorOf(request), row.entityId);
      reply.header('Content-Type', row.mime);
      reply.header('Cache-Control', 'private, max-age=86400');
      if (
        !row.mime.startsWith('image/') &&
        !row.mime.startsWith('audio/') &&
        row.mime !== 'application/pdf'
      ) {
        reply.header(
          'Content-Disposition',
          `attachment; filename="${row.originalName.replace(/[^\w.\- ]/g, '_')}"`,
        );
      }
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(opts.storage.get(row.path));
    },
  );
}
