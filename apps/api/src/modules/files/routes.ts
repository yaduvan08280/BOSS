import multipart from '@fastify/multipart';
import { createId } from '@paralleldrive/cuid2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors';
import type { Storage } from '../../lib/storage';

const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;

/** Upload and download files. Only images for now (logos, avatars); proofs/documents come with their modules. */
export async function fileRoutes(app: FastifyInstance, opts: { storage: Storage }) {
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });

  app.post('/api/files', { onRequest: [app.authenticate], schema: { tags: ['files'] } }, async (request) => {
    const file = await request.file();
    if (!file) throw new AppError(400, 'BAD_REQUEST', 'Attach a file');
    const ext = IMAGE_TYPES[file.mimetype];
    if (!ext) throw new AppError(400, 'BAD_REQUEST', 'Use a PNG, JPG or WebP image');
    const auth = request.auth!;
    const id = createId();
    const now = new Date();
    const path = `${auth.companyId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${ext}`;
    const size = await opts.storage.put(path, file.file);
    if (file.file.truncated) {
      await opts.storage.remove(path);
      throw new AppError(400, 'BAD_REQUEST', 'The file is larger than 5 MB');
    }
    const row = await request.db.attachment.create({
      data: {
        id,
        companyId: auth.companyId,
        entityType: 'upload',
        entityId: auth.userId,
        path,
        mime: file.mimetype,
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
      reply.header('Content-Type', row.mime);
      reply.header('Cache-Control', 'private, max-age=86400');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(opts.storage.get(row.path));
    },
  );
}
