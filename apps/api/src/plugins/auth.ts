import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { forCompany, setReach, type Db, type Reach, type ScopedDb } from '@mono/db';
import { narrowTo, reachFor } from '../modules/branches/reach';
import { hasPermission, type PermissionKey } from '@mono/shared';
import type { ActorContext } from '../lib/audit';
import { AppError, forbidden, unauthenticated } from '../lib/errors';
import { ACCESS_COOKIE, verifyAccessToken } from '../lib/tokens';

export type AuthContext = {
  userId: string;
  /** Set while the owner looks at MONO as this person (read-only): the owner's own id. */
  shadowOf?: string;
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
    /** How far the signed-in person sees (phase 12); only set after `authenticate`. */
    reach: Reach | null;
    /** The same before the top bar's branch switcher narrowed it. */
    reachAll: Reach | null;
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
  app.decorateRequest('reach', null);
  app.decorateRequest('reachAll', null);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const token = request.cookies[ACCESS_COOKIE];
    if (!token) throw unauthenticated();
    const claims = await verifyAccessToken(token, opts.secret);
    if (!claims) throw unauthenticated('Your session expired');
    let user = await app.prisma.user.findFirst({
      where: { id: claims.sub, companyId: claims.cid, deletedAt: null, status: 'ACTIVE', loginEnabled: true },
      select: {
        id: true,
        mustChangePassword: true,
        role: { select: { key: true, permissions: true, reach: true } },
      },
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
    // Shadow mode: an Owner may look at MONO exactly as one of their people sees it — the person's own rights and
    // reach — and only look: every request that would change something is refused.
    const viewAs = request.headers['x-mono-view-as'];
    let shadowOf: string | undefined;
    if (typeof viewAs === 'string' && viewAs && viewAs !== user.id) {
      if (user.role.key !== 'OWNER')
        throw new AppError(403, 'FORBIDDEN', 'Only an Owner can look as someone else');
      if (request.method !== 'GET')
        throw new AppError(
          403,
          'FORBIDDEN',
          'You are looking as someone else, and that view is read-only. Leave it to make changes.',
        );
      const target = await app.prisma.user.findFirst({
        where: { id: viewAs, companyId: claims.cid, deletedAt: null },
        select: {
          id: true,
          mustChangePassword: true,
          role: { select: { key: true, permissions: true, reach: true } },
        },
      });
      if (!target) throw new AppError(404, 'NOT_FOUND', 'Person not found');
      if (target.role.key === 'OWNER')
        throw new AppError(403, 'FORBIDDEN', "Another Owner's view is not open to you");
      shadowOf = user.id;
      user = { ...target, mustChangePassword: false };
    }
    request.auth = {
      userId: user.id,
      companyId: claims.cid,
      sessionId: claims.sid,
      roleKey: user.role.key,
      permissions: user.role.permissions,
      ...(shadowOf ? { shadowOf } : {}),
    };
    request.db = forCompany(app.prisma, claims.cid);
    // From here on, everything this request reads is limited to the person's reach (phase 12). The top bar's
    // branch switcher sends the branch it shows; it can only narrow.
    const only = request.headers['x-mono-branch'];
    request.reachAll = await reachFor(app.prisma, {
      companyId: claims.cid,
      userId: user.id,
      permissions: user.role.permissions,
      reach: user.role.reach,
    });
    request.reach = await narrowTo(
      app.prisma,
      claims.cid,
      request.reachAll,
      typeof only === 'string' && only ? only : null,
    );
    setReach(request.reach);
  });

  app.decorate(
    'requirePermission',
    (key: PermissionKey) => async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.auth) await app.authenticate(request, reply);
      if (!hasPermission(request.auth!.permissions, key)) throw forbidden();
    },
  );
});
