import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Env } from '../../env';
import { actorOf } from '../delegation/routes';
import { needAdmin } from '../platform/keys';
import {
  driveEnvOf,
  driveStatus,
  finishDrive,
  pauseDrive,
  startDrive,
  startSchema,
  type DriveEnv,
} from './drive';

/** System Master → Integration → Google Drive (CLAUDE.md §12). Only the owner connects; admins see the status. */
export async function integrationRoutes(app: FastifyInstance, opts: { env: Env; drive?: Partial<DriveEnv> }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;
  const tags = ['integrations'];
  const env = { ...driveEnvOf(opts.env), ...opts.drive };
  const signedIn = () => ({ onRequest: [app.authenticate] });

  r.get('/api/integrations/google-drive', { ...signedIn(), schema: { tags } }, async (q) => {
    needAdmin(actorOf(q));
    return driveStatus(db, actorOf(q), env);
  });
  r.post(
    '/api/integrations/google-drive/start',
    {
      ...signedIn(),
      schema: { tags, body: startSchema },
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    },
    async (q) => startDrive(db, actorOf(q), env, q.body),
  );
  r.post('/api/integrations/google-drive/pause', { ...signedIn(), schema: { tags } }, async (q) =>
    pauseDrive(db, actorOf(q)),
  );
  // Google sends the browser back here (a top-level GET, so the sign-in cookie comes along).
  r.get(
    '/api/integrations/google-drive/callback',
    {
      schema: {
        tags,
        hide: true,
        querystring: z.object({
          code: z.string().max(2000).optional(),
          state: z.string().max(200).optional(),
          error: z.string().max(200).optional(),
          scope: z.string().max(2000).optional(),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
    },
    async (q, reply) => {
      try {
        await app.authenticate(q, reply);
      } catch {
        return reply.redirect('/system/integration/drive?drive=signin');
      }
      return reply.redirect(await finishDrive(db, actorOf(q), env, q.query));
    },
  );
}
