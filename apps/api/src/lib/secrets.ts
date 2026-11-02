import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM for channel credentials at rest. The key is derived from APP_SECRET. */
const VERSION = 'v1';

function key(secret: string): Buffer {
  return createHash('sha256').update(`channel-secrets:${secret}`).digest();
}

export function encryptJson(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
}

export function decryptJson<T = Record<string, unknown>>(
  sealed: string | null | undefined,
  secret: string,
): T | null {
  if (!sealed) return null;
  const [version, payload] = sealed.split(':');
  if (version !== VERSION || !payload) throw new Error('Unknown secret format');
  const raw = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  return JSON.parse(text) as T;
}
