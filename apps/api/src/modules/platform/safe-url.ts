import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/** Everything that is not the public internet: private, loopback, link-local, carrier NAT, test and reserved ranges. */
const INSIDE = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  INSIDE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 127], // :: and ::1
  ['64:ff9b::', 96], // NAT64: an IPv4 address in disguise
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  INSIDE.addSubnet(net, bits, 'ipv6');

/**
 * Private, loopback, link-local and other non-public addresses (IPv4 and IPv6). An IPv4 address written as
 * IPv6 (`::ffff:127.0.0.1`, or the same in hex, `::ffff:7f00:1`) is judged as the IPv4 address it is.
 */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (!kind) return true; // not an address at all: never call it
  return INSIDE.check(ip, kind === 4 ? 'ipv4' : 'ipv6');
}

export type NetRule = { production: boolean; allowPrivate?: boolean | undefined };

/**
 * An outgoing URL is safe to call (no SSRF into the server's own network): http(s) only, https in production,
 * no credentials in it, and every address its host resolves to is public.
 */
export async function assertPublicUrl(
  raw: string,
  opts: NetRule & { resolve?: (host: string) => Promise<string[]> },
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

const MAX_ANSWER = 5 * 1024 * 1024;

/**
 * `fetch` for addresses a person typed (a webhook, a provider's endpoint, a model server). The address is
 * checked as above, and again at the moment of connecting — on the very address the connection goes to — so
 * a name that answers "public" to the check and "private" to the call gets nowhere. It never follows a
 * redirect (the answer is handed back as it is) and reads at most 5 MB.
 */
export function guardedFetch(rule: NetRule): typeof fetch {
  const guard: LookupFunction = (hostname, options, callback) =>
    dnsLookup(hostname, options, (err, address, family) => {
      const list = Array.isArray(address)
        ? (address as LookupAddress[]).map((a) => a.address)
        : [address as string];
      if (!err && !rule.allowPrivate && list.some(isPrivateAddress))
        return callback(
          Object.assign(new Error('This address points inside a private network'), { code: 'EINSIDE' }),
          address as string,
          family,
        );
      callback(err, address as string, family);
    });
  return async (input, init) => {
    const u = await assertPublicUrl(String(input instanceof Request ? input.url : input), rule);
    // Let the platform turn whatever body was given (text, a form, bytes) into bytes and headers.
    const asked = new Request(u, { ...init, signal: null });
    const body = asked.body ? Buffer.from(await asked.arrayBuffer()) : null;
    const headers: Record<string, string> = {};
    asked.headers.forEach((value, key) => (headers[key] = value));
    if (body) headers['content-length'] = String(body.length);
    return new Promise<Response>((resolve, reject) => {
      const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(
        u,
        { method: asked.method, headers, lookup: guard, signal: init?.signal ?? undefined },
        (res) => {
          const parts: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_ANSWER) return void req.destroy(new Error('The answer is too large'));
            parts.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => {
            const status = res.statusCode ?? 502;
            const out = new Headers();
            for (const [k, v] of Object.entries(res.headers))
              if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(', ') : v);
            const empty = status === 204 || status === 304 || status < 200;
            resolve(
              new Response(empty ? null : Buffer.concat(parts), {
                status: status < 200 ? 502 : status,
                headers: out,
              }),
            );
          });
        },
      );
      req.on('error', reject);
      req.end(body ?? undefined);
    });
  };
}
