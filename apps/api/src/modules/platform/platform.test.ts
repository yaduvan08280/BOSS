import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';
import { assertPublicUrl, isPrivateAddress } from './safe-url';
import { matchesEvent, queueWebhooks, sendWebhooks, WEBHOOK_TRIES } from './webhooks';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const SECRET = 'test-secret-that-is-long-enough-1234567890';
const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const v1 = (
  key: string | null,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  header = 'authorization',
) =>
  ctx.app.inject({
    method,
    url,
    headers: key ? { [header]: header === 'authorization' ? `Bearer ${key}` : key } : {},
    ...(payload ? { payload } : {}),
  });

describe('public API keys', () => {
  it('a key is shown once, works as its maker, is limited by their rights and stops when revoked', async () => {
    const o = await ownerClient(ctx.app);
    const made = await o.api.post('/api/platform/keys', { name: 'Tally connector' });
    expect(made.status).toBe(200);
    const key = made.body.key as string;
    expect(key).toMatch(/^mono_[0-9a-f]{12}_/);
    const list = (await o.api.get('/api/platform/keys')).body as { masked: string; last4: string }[];
    expect(list[0]!.masked).not.toContain(key.slice(18, 30));
    expect(JSON.stringify(list)).not.toContain(key);
    // Stored as a hash only.
    const row = await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: made.body.id } });
    expect(row.hash).not.toBe(key);
    expect(row.hash).toHaveLength(64);

    expect((await v1(null, 'GET', '/api/v1/me')).statusCode).toBe(401);
    expect((await v1('mono_000000000000_wrongwrongwrongwrongwrong', 'GET', '/api/v1/me')).statusCode).toBe(
      401,
    );
    expect(
      (await v1(key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'), 'GET', '/api/v1/me')).statusCode,
    ).toBe(401);
    const me = await v1(key, 'GET', '/api/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ actsAs: 'Test Owner' });
    expect((await v1(key, 'GET', '/api/v1/me', undefined, 'x-api-key')).statusCode).toBe(200);

    // Writes go through the same services: audit row says it came by API key.
    const cust = await v1(key, 'POST', '/api/v1/customers', { name: 'Shree Ram Tiles', city: 'Ajmer' });
    expect(cust.statusCode).toBe(200);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { entityId: cust.json().id } });
    expect(audit.userAgent).toContain('api-key');
    expect((await v1(key, 'GET', '/api/v1/customers')).json()[0]).toMatchObject({ name: 'Shree Ram Tiles' });
    expect((await v1(key, 'POST', '/api/v1/customers', { name: 'X' })).statusCode).toBe(400);

    await o.api.del(`/api/platform/keys/${made.body.id}`);
    expect((await v1(key, 'GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('only admins manage keys; a member’s key can do only what the member can', async () => {
    const o = await ownerClient(ctx.app);
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name: 'Gopal Prajapat', mobile, loginEnabled: true }))
      .body;
    const member = await signedIn(ctx.app, mobile, r.tempPassword);
    await member.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: 'Gopal12345',
    });
    expect((await member.post('/api/platform/keys', { name: 'Mine' })).status).toBe(403);
    expect((await member.get('/api/platform/webhooks')).status).toBe(403);
    // A key the owner made keeps working only while the owner is active.
    const key = (await o.api.post('/api/platform/keys', { name: 'Owner key' })).body.key as string;
    const owner = await ctx.prisma.user.findFirstOrThrow({
      where: { companyId: o.company.id, role: { key: 'OWNER' } },
    });
    await ctx.prisma.user.update({ where: { id: owner.id }, data: { status: 'INACTIVE' } });
    expect((await v1(key, 'GET', '/api/v1/me')).statusCode).toBe(401);
    await ctx.prisma.user.update({ where: { id: owner.id }, data: { status: 'ACTIVE' } });
    expect((await v1(key, 'GET', '/api/v1/me')).statusCode).toBe(200);
  });

  it('the OpenAPI document lists the public API', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json() as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/customers',
        '/api/v1/items',
        '/api/v1/stock-moves',
        '/api/v1/orders',
        '/api/v1/flows/{id}/records',
        '/api/v1/steps/{id}/complete',
      ]),
    );
    expect(Object.keys(spec.paths).every((p) => p.startsWith('/api/v1/'))).toBe(true);
  });
});

describe('outgoing webhooks', () => {
  it('addresses inside the network are refused', async () => {
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('192.168.1.10')).toBe(true);
    expect(isPrivateAddress('172.20.0.5')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    const prod = { production: true, resolve: async () => ['10.0.0.7'] };
    await expect(assertPublicUrl('http://hooks.example.com/x', prod)).rejects.toThrow(/https/);
    await expect(assertPublicUrl('https://hooks.example.com/x', prod)).rejects.toThrow(/private/);
    await expect(assertPublicUrl('https://user:pw@hooks.example.com/x', prod)).rejects.toThrow(/password/);
    await expect(
      assertPublicUrl('https://hooks.example.com/x', {
        production: true,
        resolve: async () => ['93.184.216.34'],
      }),
    ).resolves.toBeTruthy();
    expect(matchesEvent(['crm.*'], 'crm.order_taken')).toBe(true);
    expect(matchesEvent(['*'], 'auth.logged_in')).toBe(false);
    expect(matchesEvent(['ims.stock_moved'], 'ims.below_min')).toBe(false);
  });

  it('events are delivered signed, once per webhook, retried with backoff and then failed', async () => {
    const o = await ownerClient(ctx.app);
    expect(
      (await o.api.post('/api/platform/webhooks', { url: 'https://127.0.0.1/hook', events: ['*'] })).status,
    ).toBe(400);
    const made = await o.api.post('/api/platform/webhooks', {
      url: 'https://93.184.216.34/hook',
      events: ['crm.*'],
    });
    expect(made.status).toBe(200);
    const signing = made.body.secret as string;
    expect(signing).toMatch(/^whsec_/);
    expect(JSON.stringify((await o.api.get('/api/platform/webhooks')).body)).not.toContain(signing);

    await o.api.post('/api/crm/customers', { name: 'Polyrocks Vadodara', city: 'Vadodara' });
    const events = await ctx.prisma.domainEvent.findMany({ where: { companyId: o.company.id } });
    let queued = 0;
    for (const e of events) queued += await queueWebhooks(ctx.prisma, e);
    expect(queued).toBe(1);
    for (const e of events) await queueWebhooks(ctx.prisma, e); // twice → still one
    expect(await ctx.prisma.webhookDelivery.count({ where: { webhookId: made.body.id } })).toBe(1);

    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const net = (status: number) => ({
      secret: SECRET,
      production: false,
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
        return new Response('ok', { status });
      }) as unknown as typeof fetch,
    });
    const now = new Date();
    expect(await sendWebhooks(ctx.prisma, net(200), now)).toBeGreaterThanOrEqual(1);
    const mine = calls.find((c) => c.url === 'https://93.184.216.34/hook')!;
    const body = JSON.parse(mine.body);
    expect(body).toMatchObject({ event: 'crm.customer_added', data: { name: 'Polyrocks Vadodara' } });
    const expected = createHmac('sha256', signing)
      .update(`${mine.headers['X-Mono-Timestamp']}.${mine.body}`)
      .digest('hex');
    expect(mine.headers['X-Mono-Signature']).toBe(`sha256=${expected}`);
    expect(
      (await ctx.prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: made.body.id } })).status,
    ).toBe('SENT');

    // A failing receiver: retried later, then FAILED after the last try.
    await o.api.post('/api/crm/customers', { name: 'Kajaria Agencies', city: 'Jaipur' });
    for (const e of await ctx.prisma.domainEvent.findMany({ where: { companyId: o.company.id } }))
      await queueWebhooks(ctx.prisma, e);
    let t = now.getTime();
    for (let i = 0; i < WEBHOOK_TRIES; i++) {
      t += 3 * 3600_000;
      await sendWebhooks(ctx.prisma, net(500), new Date(t));
    }
    const failed = await ctx.prisma.webhookDelivery.findFirstOrThrow({
      where: { webhookId: made.body.id, status: { not: 'SENT' } },
    });
    expect(failed).toMatchObject({ status: 'FAILED', tries: WEBHOOK_TRIES, responseCode: 500 });
    const log = (await o.api.get(`/api/platform/webhooks/${made.body.id}/deliveries`)).body as unknown[];
    expect(log).toHaveLength(2);
  });
});
