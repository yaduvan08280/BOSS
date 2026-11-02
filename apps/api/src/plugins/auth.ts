import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { forCompany, type Db, type ScopedDb } from '@mono/db';
import { hasPermission, type PermissionKey } from '@mono/shared';
import type { ActorContext } from '../lib/audit';
import { AppError, forbidden, unauthenticated } from '../lib/errors';
import { ACCESS_COOKIE, verifyAccessToken } from '../lib/tokens';

export type AuthContext = {
  userId: string;
  companyId: string;
  sessionId: string;
  roleKey: string | null;
  permissions: string[];
};

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    /** Company-scoped DB client; only set after `authenticate`. */
    db: ScopedDb;
  }
  interface FastifyInstance {
    prisma: Db;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      key: PermissionKey,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function actorOf(request: FastifyRequest): ActorContext {
  if (!request.auth) throw unauthenticated();
  return {
    companyId: request.auth.companyId,
    actorId: request.auth.userId,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

/**
 * Reads the access cookie, re-checks the user and session in the DB on every request
 * (so a disabled user or revoked session stops working immediately), and attaches a company-scoped client.
 */
export default fp(async function authPlugin(app: FastifyInstance, opts: { secret: string }) {
  app.decorateRequest('auth', null);
  app.decorateRequest('db', null as unknown as ScopedDb);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const token = request.cookies[ACCESS_COOKIE];
    if (!token) throw unauthenticated();
    const claims = await verifyAccessToken(token, opts.secret);
    if (!claims) throw unauthenticated('Your session expired');
    const user = await app.prisma.user.findFirst({
      where: { id: claims.sub, companyId: claims.cid, deletedAt: null, status: 'ACTIVE', loginEnabled: true },
      select: { id: true, mustChangePassword: true, role: { select: { key: true, permissions: true } } },
    });
    const session = await app.prisma.session.findFirst({
      where: { id: claims.sid, userId: claims.sub, revokedAt: null },
      select: { id: true },
    });
    if (!user || !session) throw unauthenticated('Your session expired');
    // After an admin reset, only the auth routes work until the person picks their own password.
    if (
      user.mustChangePassword &&
      !request.url.startsWith('/api/auth/') &&
      !request.url.startsWith('/api/events')
    ) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password first');
    }
    request.auth = {
      userId: user.id,
      companyId: claims.cid,
      sessionId: claims.sid,
      roleKey: user.role.key,
      permissions: user.role.permissions,
    };
    request.db = forCompany(app.prisma, claims.cid);
  });

  app.decorate(
    'requirePermission',
    (key: PermissionKey) => async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.auth) await app.authenticate(request, reply);
      if (!hasPermission(request.auth!.permissions, key)) throw forbidden();
    },
  );
});
