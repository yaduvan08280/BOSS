import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertPublicUrl, guardedFetch, isPrivateAddress } from './safe-url';

describe('addresses a person typed are never called inside the network', () => {
  let port: number;
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    if (req.url === '/hop') return void res.writeHead(302, { location: '/secret' }).end();
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: true, url: req.url }));
  });
  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((done) => server.close(done)));

  it('knows a private address however it is written', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1', // 127.0.0.1 in hex — what a URL turns [::ffff:127.0.0.1] into
      '::ffff:a9fe:a9fe', // 169.254.169.254
      '64:ff9b::7f00:1',
      'not-an-address',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('refuses the hex form of a mapped loopback address in a URL', async () => {
    await expect(assertPublicUrl('http://[::ffff:127.0.0.1]/', { production: false })).rejects.toThrow(
      /private network/,
    );
  });

  it('refuses a name that says "public" to the check and "private" to the call', async () => {
    // The check is told the name is public; the connection then resolves `localhost` — which is not.
    const f = guardedFetch({ production: false });
    const before = hits;
    const sneaky = assertPublicUrl(`http://localhost:${port}/secret`, {
      production: false,
      resolve: async () => ['8.8.8.8'],
    });
    await expect(sneaky).resolves.toBeInstanceOf(URL); // the old one-time check would have let it through
    await expect(f(`http://localhost:${port}/secret`)).rejects.toThrow(/private network/);
    expect(hits).toBe(before);
  });

  it('calls a private address only where the operator allows it, and never follows a redirect', async () => {
    const f = guardedFetch({ production: false, allowPrivate: true });
    const res = await f(`http://127.0.0.1:${port}/hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: '/hello' });
    const hop = await f(`http://127.0.0.1:${port}/hop`);
    expect(hop.status).toBe(302);
  });
});
