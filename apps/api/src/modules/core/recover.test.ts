import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, makeCompany, signedIn } from '../../test/helpers';
import { bootstrapCompany } from './bootstrap';
import { recoverLogin } from './recover';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('reset-password command (locked-out owner)', () => {
  it('gives the owner a one-time password, signs them out and writes the audit log', async () => {
    const c = await makeCompany(ctx.app);
    const before = await signedIn(ctx.app, c.mobile, c.password);
    expect((await before.get('/api/auth/me')).status).toBe(200);

    const r = await recoverLogin(ctx.prisma, { identifier: c.email.toUpperCase() });
    expect(r.person).toMatchObject({ code: c.owner.code, role: 'Owner' });
    expect(r.company.slug).toBe(c.company.slug);

    expect((await before.get('/api/auth/me')).status).toBe(401);
    await expect(signedIn(ctx.app, c.mobile, c.password)).rejects.toThrow('login failed');
    const after = await signedIn(ctx.app, c.mobile, r.tempPassword);
    expect((await after.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);
    expect((await after.get('/api/org/users')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(
      (
        await after.post('/api/auth/change-password', {
          currentPassword: r.tempPassword,
          newPassword: 'Back12345',
        })
      ).status,
    ).toBe(200);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { companyId: c.company.id, entityId: c.owner.id, action: 'user.password_reset' },
    });
    expect(audit?.actorId).toBeNull();
  });

  it('turns the login back on (the last owner can never be switched off in the app, but be safe)', async () => {
    const c = await makeCompany(ctx.app);
    await ctx.prisma.user.update({ where: { id: c.owner.id }, data: { loginEnabled: false } });
    const r = await recoverLogin(ctx.prisma, { identifier: c.mobile });
    const after = await signedIn(ctx.app, c.mobile, r.tempPassword);
    expect((await after.get('/api/auth/me')).status).toBe(200);
  });

  it('asks for the company when the login is used in two, by slug or id', async () => {
    const first = await makeCompany(ctx.app);
    const second = await makeCompany(ctx.app, { mobile: first.mobile });
    await expect(recoverLogin(ctx.prisma, { identifier: first.mobile })).rejects.toMatchObject({
      code: 'CHOOSE_COMPANY',
      message: expect.stringContaining(second.company.slug),
    });
    const bySlug = await recoverLogin(ctx.prisma, { identifier: first.mobile, company: second.company.slug });
    expect(bySlug.company.slug).toBe(second.company.slug);
    const byId = await recoverLogin(ctx.prisma, { identifier: first.mobile, company: first.company.id });
    expect(byId.company.slug).toBe(first.company.slug);
    // The other company's owner keeps their password.
    await expect(signedIn(ctx.app, first.mobile, byId.tempPassword)).resolves.toBeTruthy();
  });

  it('explains unknown, invalid and inactive logins', async () => {
    await expect(recoverLogin(ctx.prisma, { identifier: 'nobody-here@example.com' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(recoverLogin(ctx.prisma, { identifier: 'abc' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const c = await makeCompany(ctx.app);
    await ctx.prisma.user.update({ where: { id: c.owner.id }, data: { status: 'INACTIVE' } });
    await expect(recoverLogin(ctx.prisma, { identifier: c.mobile })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('bootstrapCompany owner password', () => {
  it('refuses a weak owner password and creates nothing', async () => {
    const name = `Weak Co ${stamp()}`;
    for (const weak of ['1234', 'abcdefgh', '12345678'])
      await expect(
        bootstrapCompany(ctx.prisma, {
          companyName: name,
          ownerName: 'Owner',
          ownerEmail: `weak${stamp()}@example.com`,
          ownerPassword: weak,
        }),
      ).rejects.toThrow(/SEED_OWNER_PASSWORD.*too weak/);
    expect(await ctx.prisma.company.count({ where: { name } })).toBe(0);
  });

  it('ignores the password for a company that already exists (restarts keep working)', async () => {
    const c = await makeCompany(ctx.app);
    const again = await bootstrapCompany(ctx.prisma, {
      companyName: c.company.name,
      ownerName: 'Owner',
      ownerEmail: c.email,
      ownerPassword: '1234',
    });
    expect(again).toMatchObject({ created: false, company: { id: c.company.id } });
  });
});
