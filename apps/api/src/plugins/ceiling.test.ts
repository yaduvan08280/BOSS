import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ACCESS_COOKIE, signAccessToken } from '../lib/tokens';
import { makeApp, ownerClient } from '../test/helpers';
import errorsPlugin from './errors';
import ceilingPlugin from './ceiling';

const SECRET = 'test-secret-that-is-long-enough-1234567890';

/** A bare app with only the ceiling in front of one route, so the counting can be seen exactly. */
async function tiny(opts: { perMinute: number; addressFactor?: number }) {
  const app = Fastify();
  await app.register(errorsPlugin);
  await app.register(cookie);
  await app.register(ceilingPlugin, { secret: SECRET, ...opts });
  app.get('/api/ping', async () => ({ ok: true }));
  const as = async (person: string | null, token?: string) => {
    const t = token ?? (person ? await signAccessToken({ sub: person, cid: 'c1', sid: 's1' }, SECRET) : null);
    const r = await app.inject({
      method: 'GET',
      url: '/api/ping',
      headers: t ? { cookie: `${ACCESS_COOKIE}=${t}` } : {},
    });
    return r.statusCode;
  };
  return { app, as };
}

describe('API ceiling (coverage row A1)', () => {
  it('A1: counts per signed-in person, so people behind one internet address do not lock each other out', async () => {
    const { app, as } = await tiny({ perMinute: 3 });
    try {
      // Nineteen people at one outlet, all from the same address, each within their own ceiling
      // (and together under the address's own total of 20 people's worth).
      for (let p = 0; p < 19; p++) for (let i = 0; i < 3; i++) expect(await as(`person-${p}`)).toBe(200);
      // One of them going over is held back; the others are not.
      expect(await as('person-0')).toBe(429);
      expect(await as('person-30')).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('A1: a forged or missing sign-in is counted per address', async () => {
    const { app, as } = await tiny({ perMinute: 2 });
    try {
      const forged = await signAccessToken(
        { sub: 'someone', cid: 'c1', sid: 's1' },
        'another-secret-entirely-000000000000',
      );
      expect(await as(null, forged)).toBe(200);
      expect(await as(null)).toBe(200);
      // A different made-up person each time does not buy a fresh allowance.
      expect(await as(null, `${forged}x`)).toBe(429);
      // A real person at the same address is still served.
      expect(await as('real-person')).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('A1: one address is still held to a (much higher) total, as a flood guard', async () => {
    const { app, as } = await tiny({ perMinute: 2, addressFactor: 2 });
    try {
      expect([await as('a'), await as('a'), await as('b'), await as('b')]).toEqual([200, 200, 200, 200]);
      expect(await as('c')).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('A1: in the real app, two signed-in people from one address each get their own ceiling', async () => {
    const small = await makeApp({ API_RATE_LIMIT: '6' });
    try {
      const a = await ownerClient(small.app);
      const b = await ownerClient(small.app);
      const hit = async (c: typeof a) => (await c.api.get('/api/auth/me')).status;
      const first: number[] = [];
      for (let i = 0; i < 8; i++) first.push(await hit(a));
      expect(first.filter((s) => s === 200).length).toBeGreaterThanOrEqual(5);
      expect(first.at(-1)).toBe(429);
      expect(await hit(b)).toBe(200);
    } finally {
      await small.app.close();
    }
  });
});
