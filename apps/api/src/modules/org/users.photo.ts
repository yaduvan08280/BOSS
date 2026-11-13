import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hasPermission } from '@mono/shared';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';
import { assertMyPeople } from './users.branch';

/**
 * A person's photo: anyone sets their own; people who may edit the team set anyone's (within their
 * branches). The photo is an image uploaded by whoever saves it; `null` takes it off.
 */
export async function userPhotoRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.put(
    '/api/org/users/:id/photo',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['org'],
        params: z.object({ id: z.string() }),
        body: z.object({ fileId: z.string().nullable() }),
      },
    },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const person = await tx.user.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!person) throw notFound('Person');
        if (person.id !== ctx.actorId) {
          if (!hasPermission(request.auth!.permissions, 'org.edit'))
            throw forbidden("You can change only your own photo");
          assertMyPeople(request, [person]);
        }
        let avatarUrl: string | null = null;
        if (request.body.fileId) {
          const file = await tx.attachment.findFirst({
            where: {
              id: request.body.fileId,
              deletedAt: null,
              uploadedById: ctx.actorId,
              entityType: 'upload',
            },
          });
          if (!file) throw notFound('File');
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mime))
            throw new AppError(400, 'BAD_REQUEST', 'Use a JPG, PNG or WebP photo');
          await tx.attachment.update({
            where: { id: file.id },
            data: { entityType: 'avatar', entityId: person.id },
          });
          avatarUrl = `/api/files/${file.id}`;
        }
        await tx.user.update({ where: { id: person.id }, data: { avatarUrl } });
        await recordChange(tx, ctx, {
          event: 'user.updated',
          entityType: 'user',
          entityId: person.id,
          before: { avatarUrl: person.avatarUrl },
          after: { avatarUrl },
        });
        return { avatarUrl };
      }),
  );
}
