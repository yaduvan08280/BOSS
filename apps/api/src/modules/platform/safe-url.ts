import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Private, loopback, link-local and other non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/**
 * An outgoing URL is safe to call (no SSRF into the server's own network): http(s) only, https in production,
 * no credentials in it, and every address its host resolves to is public.
 */
export async function assertPublicUrl(
  raw: string,
  opts: { production: boolean; allowPrivate?: boolean; resolve?: (host: string) => Promise<string[]> },
) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Not a web address');
  }
  if (u.protocol !== 'https:' && (opts.production || u.protocol !== 'http:'))
    throw new Error('Use an https:// address');
  if (u.username || u.password) throw new Error('No user name or password in the address');
  if (opts.allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : await (opts.resolve ?? (async (h) => (await lookup(h, { all: true })).map((a) => a.address)))(host);
  if (!addresses.length || addresses.some(isPrivateAddress))
    throw new Error('This address points inside a private network');
  return u;
}
