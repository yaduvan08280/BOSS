import cookie from '@fastify/cookie';
import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCESS_COOKIE, signAccessToken } from '../lib/tokens';
import ceilingPlugin from './ceiling';
import errorsPlugin from './errors';

const SECRET = 'test-secret-that-is-long-enough-1234567890';
const GOOD_KEY = 'mono_0123456789ab_abcdefghijklmnopqrstuvwxyz012345';
const OFFICE = '203.0.113.7';

let app: ReturnType<typeof Fastify> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(perMinute: number, perIpMinute = 0) {
  app = Fastify();
  await app.register(errorsPlugin);
  await app.register(cookie);
  app.decorateRequest('auth', null);
  await app.register(ceilingPlugin, { perMinute, perIpMinute, secret: SECRET });
  app.get('/api/ping', async () => ({ ok: true }));
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/events', async () => ({ ok: true }));
  // Stands in for the public API's key check.
  app.get(
    '/api/v1/me',
    {
      onRequest: [
        async (q: FastifyRequest) => {
          if (q.headers.authorization !== `Bearer ${GOOD_KEY}`) throw new Error('bad key');
          q.auth = { userId: 'u', companyId: 'c', sessionId: 'api:k1', roleKey: null, permissions: [] };
        },
      ],
    },
    async () => ({ ok: true }),
  );
  return app;
}

const cookieOf = async (userId: string, secret = SECRET) =>
  `${ACCESS_COOKIE}=${await signAccessToken({ sub: userId, cid: 'c1', sid: `s-${userId}` }, secret)}`;

async function hit(headers: Record<string, string> = {}, url = '/api/ping', ip = OFFICE) {
  return (await app!.inject({ method: 'GET', url, headers, remoteAddress: ip })).statusCode;
}

describe('API ceiling', () => {
  it('does not limit many signed-in people who share one IP', async () => {
    await build(5);
    for (let u = 0; u < 50; u++) {
      const c = await cookieOf(`user${u}`);
      for (let i = 0; i < 5; i++) expect(await hit({ cookie: c })).toBe(200);
    }
    // ...and their traffic leaves the IP's budget for requests that are not signed in untouched.
    expect(await hit()).toBe(200);
  });

  it('limits one signed-in person over the limit, wherever they call from, and nobody else', async () => {
    await build(5);
    const a = await cookieOf('a');
    for (let i = 0; i < 5; i++) expect(await hit({ cookie: a })).toBe(200);
    const res = await app!.inject({ method: 'GET', url: '/api/ping', headers: { cookie: a }, remoteAddress: OFFICE });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(await hit({ cookie: a }, '/api/ping', '198.51.100.9')).toBe(429);
    expect(await hit({ cookie: await cookieOf('b') })).toBe(200);
  });

  it('still limits requests that are not signed in per IP', async () => {
    await build(5);
    for (let i = 0; i < 5; i++) expect(await hit()).toBe(200);
    expect(await hit()).toBe(429);
    expect(await hit({}, '/api/ping', '198.51.100.9')).toBe(200);
  });

  it('counts a forged, expired or garbage cookie by IP', async () => {
    await build(3);
    const forged = await cookieOf('a', 'another-secret-that-is-long-enough-123456');
    const codes = [
      await hit({ cookie: forged }),
      await hit({ cookie: await cookieOf('b', 'x'.repeat(40)) }),
      await hit({ cookie: `${ACCESS_COOKIE}=garbage` }),
      await hit({ cookie: forged }),
    ];
    expect(codes).toEqual([200, 200, 200, 429]);
  });

  it('counts an API key as itself only once it has authenticated; made-up keys count by IP', async () => {
    await build(3);
    const fake = (n: number) => ({ authorization: `Bearer mono_${String(n).padStart(12, '0')}_${'x'.repeat(32)}` });
    const good = { authorization: `Bearer ${GOOD_KEY}` };
    // The first call of a real key is counted by IP (1 of 3); after it the key has its own budget.
    expect(await hit(good, '/api/v1/me')).toBe(200);
    for (let i = 0; i < 3; i++) expect(await hit(good, '/api/v1/me')).toBe(200);
    expect(await hit(good, '/api/v1/me')).toBe(429);
    // A different made-up key each time gets no budget of its own.
    expect([await hit(fake(1)), await hit(fake(2)), await hit(fake(3))]).toEqual([200, 200, 429]);
  });

  it('has a higher total for signed-in traffic from one IP', async () => {
    await build(5, 8);
    const codes: number[] = [];
    for (let u = 0; u < 3; u++) {
      const c = await cookieOf(`user${u}`);
      for (let i = 0; i < 3; i++) codes.push(await hit({ cookie: c }));
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 429]);
    expect(await hit({ cookie: await cookieOf('user9') }, '/api/ping', '198.51.100.9')).toBe(200);
  });

  it('does not count live updates or the health check, and is off at 0', async () => {
    await build(2);
    for (let i = 0; i < 5; i++) {
      expect(await hit({}, '/api/health')).toBe(200);
      expect(await hit({}, '/api/events')).toBe(200);
    }
    expect([await hit(), await hit(), await hit()]).toEqual([200, 200, 429]);
    await app!.close();
    await build(0);
    for (let i = 0; i < 10; i++) expect(await hit()).toBe(200);
  });
});
