import type { Db } from '@mono/db';
import type { Me } from '@mono/shared';
import { readAppearance } from '../org/company.routes';
import { pendingCounts } from '../work/counts';
import type { ActorContext } from '../../lib/audit';
import { AppError, unauthenticated } from '../../lib/errors';
import { identifierWhere } from '../../lib/identifier';
import { recordChange } from '../../lib/events';
import { hashPassword, verifyPassword } from '../../lib/password';
import { hashToken, newRefreshToken, REFRESH_TTL_SECONDS } from '../../lib/tokens';

type ClientInfo = { ip: string | null; userAgent: string | null };

/**
 * Check credentials. One identifier can exist in several companies: if the password matches more than
 * one and no company was chosen, ask the user to pick (CHOOSE_COMPANY).
 */
export async function verifyLogin(db: Db, identifier: string, password: string, companyId?: string) {
  const where = identifierWhere(identifier);
  const candidates = where
    ? await db.user.findMany({
        where: {
          ...where,
          ...(companyId ? { companyId } : {}),
          deletedAt: null,
          status: 'ACTIVE',
          loginEnabled: true,
          company: { deletedAt: null },
        },
        select: { id: true, companyId: true, passwordHash: true, company: { select: { name: true } } },
        take: 10,
      })
    : [];
  if (candidates.length === 0) {
    await verifyPassword(null, password);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong mobile/email or password');
  }
  const matches = [];
  for (const c of candidates) if (await verifyPassword(c.passwordHash, password)) matches.push(c);
  if (matches.length === 0) throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong mobile/email or password');
  if (matches.length > 1) {
    throw new AppError(409, 'CHOOSE_COMPANY', 'Choose your company', {
      companies: matches.map((m) => ({ id: m.companyId, name: m.company.name })),
    });
  }
  return matches[0]!;
}

export async function createSession(db: Db, userId: string, companyId: string, client: ClientInfo) {
  const refreshToken = newRefreshToken();
  const session = await db.session.create({
    data: {
      companyId,
      userId,
      tokenHash: hashToken(refreshToken),
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    },
  });
  return { session, refreshToken };
}

export async function login(
  db: Db,
  input: { identifier: string; password: string; companyId?: string },
  client: ClientInfo,
) {
  const user = await verifyLogin(db, input.identifier, input.password, input.companyId);
  const { session, refreshToken } = await createSession(db, user.id, user.companyId, client);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordChange(
      tx,
      { companyId: user.companyId, actorId: user.id, ...client },
      { event: 'auth.logged_in', entityType: 'user', entityId: user.id, payload: { sessionId: session.id } },
    );
  });
  return { userId: user.id, companyId: user.companyId, sessionId: session.id, refreshToken };
}

/**
 * Rotate a refresh token. Re-using an already-rotated token means it was stolen:
 * every session of that user is revoked.
 */
export async function refresh(db: Db, refreshToken: string, client: ClientInfo) {
  const old = await db.session.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
  if (!old) throw unauthenticated('Your session expired');
  if (old.revokedAt) {
    if (old.replacedById) {
      await db.session.updateMany({
        where: { userId: old.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    throw unauthenticated('Your session expired');
  }
  if (old.expiresAt < new Date()) throw unauthenticated('Your session expired');
  const user = await db.user.findFirst({
    where: { id: old.userId, deletedAt: null, status: 'ACTIVE', loginEnabled: true },
    select: { id: true },
  });
  if (!user) throw unauthenticated('Your account is not active');
  const next = await createSession(db, old.userId, old.companyId, client);
  const rotated = await db.session.updateMany({
    where: { id: old.id, revokedAt: null },
    data: { revokedAt: new Date(), replacedById: next.session.id, lastUsedAt: new Date() },
  });
  if (rotated.count === 0) {
    // Lost a race with a parallel refresh using the same token.
    await db.session.update({ where: { id: next.session.id }, data: { revokedAt: new Date() } });
    throw unauthenticated('Your session expired');
  }
  return {
    userId: old.userId,
    companyId: old.companyId,
    sessionId: next.session.id,
    refreshToken: next.refreshToken,
  };
}

export async function logout(db: Db, sessionId: string, ctx: ActorContext) {
  await db.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordChange(tx, ctx, { event: 'auth.logged_out', entityType: 'user', entityId: ctx.actorId! });
  });
}

export async function changePassword(
  db: Db,
  ctx: ActorContext & { actorId: string },
  input: { currentPassword: string; newPassword: string },
) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: ctx.actorId },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Your current password is wrong', {
      fields: { currentPassword: 'Wrong password' },
    });
  }
  const passwordHash = await hashPassword(input.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: ctx.actorId },
      data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
    });
    await tx.session.updateMany({
      where: { userId: ctx.actorId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordChange(tx, ctx, {
      event: 'auth.password_changed',
      entityType: 'user',
      entityId: ctx.actorId,
    });
  });
}

export async function updatePreferences(
  db: Db,
  userId: string,
  input: { lang?: 'en' | 'hi' | undefined; themeMode?: 'light' | 'dark' | 'system' | undefined },
) {
  await db.user.update({ where: { id: userId }, data: input });
}

export async function getMe(db: Db, userId: string, appName: string): Promise<Me> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: true, company: true },
  });
  const look = readAppearance(user.company.settings, appName);
  const prefs = (user.prefs ?? {}) as { favourites?: unknown };
  return {
    user: {
      id: user.id,
      code: user.code,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      lang: user.lang === 'hi' ? 'hi' : 'en',
      themeMode: user.themeMode === 'light' || user.themeMode === 'dark' ? user.themeMode : 'system',
      avatarUrl: user.avatarUrl,
      roleName: user.role.name,
      roleKey: user.role.key,
      permissions: user.role.permissions,
      mustChangePassword: user.mustChangePassword,
      favourites: Array.isArray(prefs.favourites)
        ? prefs.favourites.filter((f): f is string => typeof f === 'string')
        : [],
    },
    company: {
      id: user.company.id,
      name: user.company.name,
      appName: look.appName,
      timezone: user.company.timezone,
      fyStartMonth: user.company.fyStartMonth,
      theme: look.theme,
      logoUrl: look.logoFileId ? `/api/files/${look.logoFileId}` : null,
      defaultLang: look.defaultLang,
      staffMayPickAccent: look.staffMayPickAccent,
      // Phase 14: the hospitality menu is shown only to companies that switched it on.
      hospitality:
        (
          await db.hospSettings.findUnique({
            where: { companyId: user.companyId },
            select: { enabled: true },
          })
        )?.enabled ?? false,
    },
    counters: {
      pendingWork: (await pendingCounts(db, user.companyId, user.id)).total,
      unreadNotifications: await db.notification.count({ where: { userId: user.id, readAt: null } }),
    },
  };
}

export async function setFavourites(db: Db, userId: string, favourites: string[]) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { prefs: true } });
  await db.user.update({
    where: { id: userId },
    data: {
      prefs: { ...((user.prefs ?? {}) as Record<string, unknown>), favourites: [...new Set(favourites)] },
    },
  });
}
