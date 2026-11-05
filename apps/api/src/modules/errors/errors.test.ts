import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';
import { recordError } from './service';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('error monitoring', () => {
  it('groups the same error, counts it, reopens it, and keeps companies apart', async () => {
    const a = await ownerClient(ctx.app);
    const b = await ownerClient(ctx.app);
    const stack = 'TypeError: x\n    at render (/app/assets/index-abc.js:10:20)';
    await a.api.post('/api/errors', {
      message: 'Cannot read properties of undefined (reading "name") at row 12',
      stack,
      path: '/crm/customers',
    });
    await a.api.post('/api/errors', {
      message: 'Cannot read properties of undefined (reading "name") at row 47',
      stack,
      path: '/crm/customers/x',
    });
    const list = (await a.api.get('/api/system/errors')).body as {
      id: string;
      count: number;
      source: string;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ count: 2, source: 'web' });
    expect((await b.api.get('/api/system/errors')).body).toHaveLength(0);

    await a.api.post(`/api/system/errors/${list[0]!.id}/resolve`, {});
    expect((await a.api.get('/api/system/errors')).body).toHaveLength(0);
    expect((await a.api.get('/api/system/errors?all=1')).body).toHaveLength(1);
    await recordError(ctx.prisma, {
      source: 'web',
      message: 'Cannot read properties of undefined (reading "name") at row 3',
      stack,
      companyId: a.company.id,
    });
    expect((await a.api.get('/api/system/errors')).body[0]).toMatchObject({ count: 3, resolvedAt: null });
    // Other companies can't close it.
    expect((await b.api.post(`/api/system/errors/${list[0]!.id}/resolve`, {})).status).toBe(404);
  });

  it('members can report but not read', async () => {
    const o = await ownerClient(ctx.app);
    const mobile = `9${String(Date.now()).slice(-9)}`;
    const r = (await o.api.post('/api/org/users', { name: 'Ravi Kumar', mobile, loginEnabled: true })).body;
    const m = await signedIn(ctx.app, mobile, r.tempPassword);
    await m.post('/api/auth/change-password', { currentPassword: r.tempPassword, newPassword: 'Ravi123456' });
    expect((await m.post('/api/errors', { message: 'boom' })).status).toBe(200);
    expect((await m.get('/api/system/errors')).status).toBe(403);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/errors', payload: { message: 'x' } })).statusCode,
    ).toBe(401);
  });
});

describe('API ceiling', () => {
  it('limits calls per IP per minute but leaves health checks alone', async () => {
    const small = await makeApp({ API_RATE_LIMIT: '5' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) codes.push((await small.app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode);
      expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
      expect(codes.slice(5)).toEqual([429, 429]);
      expect((await small.app.inject({ method: 'GET', url: '/api/health' })).statusCode).not.toBe(429);
    } finally {
      await small.app.close();
    }
  });
});
