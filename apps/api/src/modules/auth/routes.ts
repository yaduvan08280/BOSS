import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  apiErrorSchema,
  changePasswordSchema,
  LANGUAGES,
  loginSchema,
  meSchema,
  THEME_MODES,
} from '@mono/shared';
import type { Env } from '../../env';
import { actorOf } from '../../plugins/auth';
import { unauthenticated } from '../../lib/errors';
import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  hashToken,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
  signAccessToken,
} from '../../lib/tokens';
import * as auth from './service';

const okSchema = z.object({ ok: z.literal(true) });
const errors = { 400: apiErrorSchema, 401: apiErrorSchema, 409: apiErrorSchema, 429: apiErrorSchema };

export async function authRoutes(app: FastifyInstance, opts: { env: Env }) {
  const { env } = opts;
  const r = app.withTypeProvider<ZodTypeProvider>();

  const client = (request: FastifyRequest) => ({
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  });

  async function setSessionCookies(
    reply: FastifyReply,
    s: { userId: string; companyId: string; sessionId: string; refreshToken: string },
  ) {
    const access = await signAccessToken(
      { sub: s.userId, cid: s.companyId, sid: s.sessionId },
      env.APP_SECRET,
    );
    const base = { httpOnly: true, sameSite: 'lax' as const, secure: env.cookieSecure };
    reply.setCookie(ACCESS_COOKIE, access, { ...base, path: '/api', maxAge: ACCESS_TTL_SECONDS });
    reply.setCookie(REFRESH_COOKIE, s.refreshToken, {
      ...base,
      path: '/api/auth',
      maxAge: REFRESH_TTL_SECONDS,
    });
  }

  function clearCookies(reply: FastifyReply) {
    reply.clearCookie(ACCESS_COOKIE, { path: '/api' });
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  r.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: env.LOGIN_RATE_LIMIT,
          timeWindow: '15 minutes',
          keyGenerator: (req: FastifyRequest) => String(req.headers['cf-connecting-ip'] ?? req.ip),
        },
      },
      schema: { tags: ['auth'], body: loginSchema, response: { 200: okSchema, ...errors } },
    },
    async (request, reply) => {
      const s = await auth.login(app.prisma, request.body, client(request));
      await setSessionCookies(reply, s);
      return { ok: true as const };
    },
  );

  r.post(
    '/api/auth/refresh',
    { schema: { tags: ['auth'], response: { 200: okSchema, 401: apiErrorSchema } } },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (!token) throw unauthenticated();
      try {
        const s = await auth.refresh(app.prisma, token, client(request));
        await setSessionCookies(reply, s);
        return { ok: true as const };
      } catch (err) {
        clearCookies(reply);
        throw err;
      }
    },
  );

  r.post(
    '/api/auth/logout',
    { schema: { tags: ['auth'], response: { 200: okSchema } } },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (token) {
        const session = await app.prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
        if (session && !session.revokedAt) {
          await auth.logout(app.prisma, session.id, {
            companyId: session.companyId,
            actorId: session.userId,
            ...client(request),
          });
        }
      }
      clearCookies(reply);
      return { ok: true as const };
    },
  );

  r.get(
    '/api/auth/me',
    {
      onRequest: [app.authenticate],
      schema: { tags: ['auth'], response: { 200: meSchema, 401: apiErrorSchema } },
    },
    async (request) => auth.getMe(app.prisma, request.auth!.userId, env.APP_NAME),
  );

  r.patch(
    '/api/auth/me/preferences',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        body: z.object({ lang: z.enum(LANGUAGES).optional(), themeMode: z.enum(THEME_MODES).optional() }),
        response: { 200: okSchema, ...errors },
      },
    },
    async (request) => {
      await auth.updatePreferences(app.prisma, request.auth!.userId, request.body);
      return { ok: true as const };
    },
  );

  r.post(
    '/api/auth/change-password',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: { tags: ['auth'], body: changePasswordSchema, response: { 200: okSchema, ...errors } },
    },
    async (request, reply) => {
      const ctx = actorOf(request);
      await auth.changePassword(app.prisma, { ...ctx, actorId: request.auth!.userId }, request.body);
      // All sessions were revoked; keep this device signed in with a fresh one.
      const { session, refreshToken } = await auth.createSession(
        app.prisma,
        request.auth!.userId,
        request.auth!.companyId,
        client(request),
      );
      await setSessionCookies(reply, {
        userId: request.auth!.userId,
        companyId: request.auth!.companyId,
        sessionId: session.id,
        refreshToken,
      });
      return { ok: true as const };
    },
  );
}
