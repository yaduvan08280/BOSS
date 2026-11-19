import { createHash } from 'node:crypto';
import type { Db } from '@mono/db';
import { AppError } from '../../lib/errors';
import { identifierWhere } from '../../lib/identifier';

/** Wrong passwords allowed for one login ID inside the window before it is locked. */
export const MAX_FAILS = 10;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

/** The same key however the ID was typed (spaces, +91, capitals). */
const keyOf = (identifier: string) =>
  createHash('sha256')
    .update(JSON.stringify(identifierWhere(identifier) ?? identifier.trim().toLowerCase()))
    .digest('hex');

/**
 * Account lockout (decision 250). The per-address limit on the sign-in route stops one machine; this stops
 * one account being guessed at from many machines: after MAX_FAILS wrong passwords in the window, that login
 * ID is refused for LOCK_MS — also with the right password, so a guesser learns nothing from the answer.
 */
export async function assertNotLocked(db: Db, identifier: string, now = new Date()) {
  const row = await db.loginThrottle.findUnique({ where: { key: keyOf(identifier) } });
  if (row?.lockedUntil && row.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 60_000));
    throw new AppError(
      429,
      'RATE_LIMITED',
      `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }
}

/** One more wrong password for this login ID (one statement, so parallel guesses all count). */
export async function noteFailure(db: Db, identifier: string, now = new Date()) {
  const key = keyOf(identifier);
  const fresh = new Date(now.getTime() - WINDOW_MS);
  const locked = new Date(now.getTime() + LOCK_MS);
  await db.$executeRaw`
    insert into login_throttles (key, fails, window_at) values (${key}, 1, ${now})
    on conflict (key) do update set
      fails = case when login_throttles.window_at < ${fresh} then 1 else login_throttles.fails + 1 end,
      window_at = case when login_throttles.window_at < ${fresh} then ${now} else login_throttles.window_at end,
      locked_until = case
        when login_throttles.window_at >= ${fresh} and login_throttles.fails + 1 >= ${MAX_FAILS} then ${locked}
        else login_throttles.locked_until end`;
}

export async function noteSuccess(db: Db, identifier: string) {
  await db.loginThrottle.deleteMany({ where: { key: keyOf(identifier) } });
}

/** Rows whose window and lock are both over (the worker's clean-up). */
export async function sweepThrottles(db: Db, now = new Date()) {
  const old = new Date(now.getTime() - WINDOW_MS);
  const gone = await db.loginThrottle.deleteMany({
    where: { windowAt: { lt: old }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
  });
  return gone.count;
}
