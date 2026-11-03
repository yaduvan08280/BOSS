import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Env } from '../../env';
import { AppError } from '../../lib/errors';
import { parseDefinition, startRecord } from './engine';

const sign = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url');

/** A small sum ("4 + 7") signed with the server secret, valid 30 minutes: no cookies, no third party. */
function challenge(secret: string) {
  const a = randomInt(1, 10);
  const b = randomInt(1, 10);
  const expires = Date.now() + 30 * 60_000;
  return { question: `${a} + ${b}`, token: `${expires}.${sign(secret, `${a + b}:${expires}`)}` };
}

function checkChallenge(secret: string, token: string, answer: number) {
  const [expires, mac] = token.split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  const want = Buffer.from(sign(secret, `${answer}:${expires}`));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * Share-a-form (CLAUDE.md §6.2): customers and vendors fill a flow's start form from a public link.
 * Rate-limited per IP, a hidden honeypot field, and a signed sum instead of a third-party captcha.
 */
export async function publicFormRoutes(app: FastifyInstance, opts: { env: Env }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const secret = opts.env.APP_SECRET;
  const token = z.object({ token: z.string().min(10).max(64) });

  async function flowFor(t: string) {
    const flow = await app.prisma.flow.findFirst({
      where: { publicToken: t, publicEnabled: true, status: 'PUBLISHED', deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!flow?.versions[0]) throw new AppError(404, 'NOT_FOUND', 'This form is not available');
    return flow;
  }

  r.get(
    '/api/public/forms/:token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['public'], params: token },
    },
    async (q) => {
      const flow = await flowFor(q.params.token);
      const company = await app.prisma.company.findUniqueOrThrow({
        where: { id: flow.companyId },
        select: { name: true, settings: true },
      });
      const settings = (company.settings ?? {}) as { appName?: string; logoUrl?: string };
      // Never hand out people/master pickers to the public: only plain fields.
      const fields = parseDefinition(flow.versions[0]!.definition).startFields.filter(
        (f) => !['master', 'signature'].includes(f.type),
      );
      return {
        company: company.name,
        appName: settings.appName ?? null,
        logoUrl: settings.logoUrl ?? null,
        flow: flow.name,
        runName: flow.runName,
        fields,
        challenge: challenge(secret),
      };
    },
  );

  r.post(
    '/api/public/forms/:token',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['public'],
        params: token,
        body: z.object({
          data: z.record(z.string(), z.unknown()),
          challenge: z.string().max(200),
          answer: z.coerce.number().int(),
          website: z.string().max(200).optional(),
        }),
      },
    },
    async (q) => {
      const flow = await flowFor(q.params.token);
      // Bots fill every box, including the hidden one; people never see it.
      if (q.body.website) return { ok: true, number: null };
      if (!checkChallenge(secret, q.body.challenge, q.body.answer))
        throw new AppError(400, 'VALIDATION_FAILED', 'The sum is not right — try again', {
          challenge: challenge(secret),
        });
      const record = await startRecord(app.prisma, {
        companyId: flow.companyId,
        flowId: flow.id,
        data: q.body.data,
        startedById: null,
        source: 'public',
      });
      return { ok: true, number: record.number };
    },
  );
}
