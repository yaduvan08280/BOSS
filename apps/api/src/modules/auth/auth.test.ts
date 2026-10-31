import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asHeader, cookieHeader, makeApp, makeCompany, ORIGIN } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx.app.close();
});

async function login(identifier: string, password: string, companyId?: string) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: ORIGIN },
    payload: { identifier, password, ...(companyId ? { companyId } : {}) },
  });
}

describe('auth', () => {
  it('logs in by mobile in any common format and by email', async () => {
    const { mobile, email, password, owner } = await makeCompany(ctx.app);
    const byMobile = await login(`+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`, password);
    expect(byMobile.statusCode).toBe(200);
    const names = (byMobile.cookies as { name: string; httpOnly?: boolean }[]).map((c) => c.name).sort();
    expect(names).toEqual(['mono_at', 'mono_rt']);
    expect((byMobile.cookies as { httpOnly?: boolean }[]).every((c) => c.httpOnly)).toBe(true);

    const byEmail = await login(email.toUpperCase(), password);
    expect(byEmail.statusCode).toBe(200);

    const me = await ctx.app.inject({
      url: '/api/auth/me',
      headers: { cookie: asHeader(cookieHeader(byEmail)) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(owner.id);
    expect(me.json().user.roleName).toBe('Owner');
    expect(me.json().company.theme.seed).toBe('#EFC75E');
  });

  it('rejects wrong passwords with the standard error shape', async () => {
    const { mobile } = await makeCompany(ctx.app);
    const res = await login(mobile, 'nope-wrong');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: expect.any(String) } });
    expect((await login('9999999999', 'whatever')).statusCode).toBe(401);
  });

  it('validates input', async () => {
    const res = await login('', '');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('requires a session for /me', async () => {
    const res = await ctx.app.inject({ url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('asks which company when one login exists in two companies', async () => {
    const first = await makeCompany(ctx.app);
    const second = await makeCompany(ctx.app, { mobile: first.mobile });
    const res = await login(first.mobile, first.password);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CHOOSE_COMPANY');
    const ids = res
      .json()
      .error.details.companies.map((c: { id: string }) => c.id)
      .sort();
    expect(ids).toEqual([first.company.id, second.company.id].sort());
    const chosen = await login(first.mobile, first.password, second.company.id);
    expect(chosen.statusCode).toBe(200);
  });

  it('rotates refresh tokens and revokes everything when an old one is reused', async () => {
    const { mobile, password } = await makeCompany(ctx.app);
    const jar1 = cookieHeader(await login(mobile, password));
    const r1 = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: asHeader(jar1), origin: ORIGIN },
    });
    expect(r1.statusCode).toBe(200);
    const jar2 = cookieHeader(r1, jar1);
    expect(jar2.mono_rt).not.toBe(jar1.mono_rt);

    const reuse = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: asHeader(jar1), origin: ORIGIN },
    });
    expect(reuse.statusCode).toBe(401);
    // The legitimate new session is gone too.
    const me = await ctx.app.inject({ url: '/api/auth/me', headers: { cookie: asHeader(jar2) } });
    expect(me.statusCode).toBe(401);
  });

  it('logs out and kills the session', async () => {
    const { mobile, password } = await makeCompany(ctx.app);
    const jar = cookieHeader(await login(mobile, password));
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: asHeader(jar), origin: ORIGIN },
    });
    expect(out.statusCode).toBe(200);
    const me = await ctx.app.inject({ url: '/api/auth/me', headers: { cookie: asHeader(jar) } });
    expect(me.statusCode).toBe(401);
  });

  it('changes the password, revokes other sessions, keeps this device', async () => {
    const { mobile, password } = await makeCompany(ctx.app);
    const phone = cookieHeader(await login(mobile, password));
    const laptop = cookieHeader(await login(mobile, password));
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: asHeader(laptop), origin: ORIGIN },
      payload: { currentPassword: 'wrong-one', newPassword: 'NewSecret456' },
    });
    expect(bad.statusCode).toBe(400);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: asHeader(laptop), origin: ORIGIN },
      payload: { currentPassword: password, newPassword: 'NewSecret456' },
    });
    expect(res.statusCode).toBe(200);
    const laptopNow = cookieHeader(res, laptop);
    expect(
      (await ctx.app.inject({ url: '/api/auth/me', headers: { cookie: asHeader(laptopNow) } })).statusCode,
    ).toBe(200);
    expect(
      (await ctx.app.inject({ url: '/api/auth/me', headers: { cookie: asHeader(phone) } })).statusCode,
    ).toBe(401);
    expect((await login(mobile, password)).statusCode).toBe(401);
    expect((await login(mobile, 'NewSecret456')).statusCode).toBe(200);
  });

  it('blocks a disabled user immediately, even with a valid access token', async () => {
    const { mobile, password, owner } = await makeCompany(ctx.app);
    const jar = cookieHeader(await login(mobile, password));
    await ctx.prisma.user.update({ where: { id: owner.id }, data: { status: 'LEFT' } });
    expect(
      (await ctx.app.inject({ url: '/api/auth/me', headers: { cookie: asHeader(jar) } })).statusCode,
    ).toBe(401);
  });

  it('rejects data changes from a foreign origin', async () => {
    const { mobile, password } = await makeCompany(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { identifier: mobile, password },
    });
    expect(res.statusCode).toBe(403);
  });

  it('writes audit rows and outbox events for logins', async () => {
    const { mobile, password, owner, company } = await makeCompany(ctx.app);
    await login(mobile, password);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { companyId: company.id, entityId: owner.id },
    });
    expect(audit.map((a) => a.action)).toContain('auth.logged_in');
    const events = await ctx.prisma.domainEvent.findMany({ where: { companyId: company.id } });
    expect(events.map((e) => e.name).sort()).toEqual(['auth.logged_in', 'company.created', 'user.created']);
  });
});

describe('login rate limit', () => {
  it('returns 429 after too many attempts', async () => {
    const limited = await makeApp({ LOGIN_RATE_LIMIT: '3' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await limited.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { identifier: '9811111111', password: 'x' },
        });
        codes.push(res.statusCode);
      }
      expect(codes).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.app.close();
    }
  });
});
