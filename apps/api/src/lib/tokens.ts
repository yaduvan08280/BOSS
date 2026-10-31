import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
export const ACCESS_COOKIE = 'mono_at';
export const REFRESH_COOKIE = 'mono_rt';

export type AccessClaims = { sub: string; cid: string; sid: string };

const keyCache = new Map<string, Uint8Array>();
function key(secret: string): Uint8Array {
  let k = keyCache.get(secret);
  if (!k) {
    k = createHash('sha256').update(`access-token:${secret}`).digest();
    keyCache.set(secret, k);
  }
  return k;
}

export async function signAccessToken(claims: AccessClaims, secret: string): Promise<string> {
  return new SignJWT({ cid: claims.cid, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(key(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.cid !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      return null;
    }
    return { sub: payload.sub, cid: payload.cid, sid: payload.sid };
  } catch {
    return null;
  }
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
