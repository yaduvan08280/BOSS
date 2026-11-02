import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;

describe('users', () => {
  it('gives auto codes and a one-time password that must be changed', async () => {
    const { api } = await ownerClient(ctx.app);
    const mobile = rnd();
    const res = await api.post('/api/org/users', { name: 'Priya Sharma', mobile, loginEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.person.code).toBe('EMP-002');
    expect(res.body.tempPassword).toMatch(/^.{4}-.{6}$/);

    const priya = await signedIn(ctx.app, mobile, res.body.tempPassword);
    expect((await priya.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);
    expect((await priya.get('/api/org/users')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(
      (
        await priya.post('/api/auth/change-password', {
          currentPassword: res.body.tempPassword,
          newPassword: 'Priya12345',
        })
      ).status,
    ).toBe(200);
    expect((await priya.get('/api/org/users')).status).toBe(200);
  });

  it('rejects a mobile that someone already uses', async () => {
    const { api, mobile } = await ownerClient(ctx.app);
    const res = await api.post('/api/org/users', { name: 'Copy', mobile });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('already uses this mobile');
  });

  it('imports a pasted list, creating missing departments, all or nothing', async () => {
    const { api, mobile } = await ownerClient(ctx.app);
    const people = [
      { name: 'A One', mobile: rnd(), email: null, department: 'Dispatch', designation: 'Driver' },
      { name: 'B Two', mobile: null, email: 'b@two.in', department: 'dispatch', designation: null },
    ];
    const bad = await api.post('/api/org/users/bulk', {
      people: [...people, { name: 'Clash', mobile, email: null, department: null, designation: null }],
    });
    expect(bad.status).toBe(409);
    expect(bad.body.error.details.lines).toEqual([
      { index: 2, message: expect.stringContaining('already uses') },
    ]);
    expect(((await api.get('/api/org/users')).body as unknown[]).length).toBe(1);

    const ok = await api.post('/api/org/users/bulk', { people });
    expect(ok.body).toMatchObject({ created: 2, newDepartments: ['Dispatch'], newDesignations: ['Driver'] });
    const depts = (await api.get('/api/org/departments')).body as { name: string; peopleCount: number }[];
    expect(depts).toEqual([expect.objectContaining({ name: 'Dispatch', peopleCount: 2 })]);
  });

  it('bulk-enables logins and skips people without a login ID', async () => {
    const { api } = await ownerClient(ctx.app);
    const a = (await api.post('/api/org/users', { name: 'With Phone', mobile: rnd() })).body.person;
    const b = (await api.post('/api/org/users', { name: 'No Contact' })).body.person;
    const res = await api.post('/api/org/users/bulk-action', {
      action: 'enableLogin',
      userIds: [a.id, b.id],
      enabled: true,
    });
    expect(res.body.passwords).toHaveLength(1);
    expect(res.body.skipped).toBe(1);
  });

  it('never removes the last owner or lets you delete yourself', async () => {
    const { api, owner } = await ownerClient(ctx.app);
    expect((await api.del(`/api/org/users/${owner.id}`)).status).toBe(400);
    const roles = (await api.get('/api/org/roles')).body.roles as { id: string; key: string }[];
    const member = roles.find((r) => r.key === 'MEMBER')!;
    expect((await api.patch(`/api/org/users/${owner.id}`, { roleId: member.id })).status).toBe(409);
  });

  it('reset password signs the person out everywhere', async () => {
    const { api } = await ownerClient(ctx.app);
    const mobile = rnd();
    const first = (await api.post('/api/org/users', { name: 'Ravi', mobile, loginEnabled: true })).body;
    const ravi = await signedIn(ctx.app, mobile, first.tempPassword);
    const reset = await api.post(`/api/org/users/${first.person.id}/reset-password`);
    expect(reset.body.tempPassword).not.toBe(first.tempPassword);
    expect((await ravi.get('/api/auth/me')).status).toBe(401);
  });
});

describe('permissions and company isolation', () => {
  it('a Member can look but not change; HR details stay hidden', async () => {
    const { api } = await ownerClient(ctx.app);
    const mobile = rnd();
    const created = (await api.post('/api/org/users', { name: 'Member Mohan', mobile, loginEnabled: true }))
      .body;
    await api.patch(`/api/org/users/${created.person.id}`, { hr: { biometricId: 'B-17', salary: 25000 } });
    expect(((await api.get('/api/org/users')).body as { hr?: unknown }[]).some((u) => u.hr)).toBe(true);

    const member = await signedIn(ctx.app, mobile, created.tempPassword);
    await member.post('/api/auth/change-password', {
      currentPassword: created.tempPassword,
      newPassword: 'Mohan12345',
    });
    const list = (await member.get('/api/org/users')).body as { hr?: unknown }[];
    expect(list.every((u) => u.hr === undefined)).toBe(true);
    expect((await member.post('/api/org/users', { name: 'Sneaky' })).status).toBe(403);
    expect((await member.post('/api/org/departments', { name: 'Sneaky' })).status).toBe(403);
    expect((await member.get('/api/system/summary')).status).toBe(403);
    expect((await member.put('/api/org/appearance', {})).status).toBe(403);
  });

  it("can't see or touch another company's people", async () => {
    const a = await ownerClient(ctx.app);
    const b = await ownerClient(ctx.app);
    const target = (await b.api.post('/api/org/users', { name: 'Only In B' })).body.person;
    expect(((await a.api.get('/api/org/users')).body as { id: string }[]).map((u) => u.id)).not.toContain(
      target.id,
    );
    expect((await a.api.patch(`/api/org/users/${target.id}`, { name: 'Hacked' })).status).toBe(404);
    expect((await a.api.del(`/api/org/users/${target.id}`)).status).toBe(404);
    const dept = (await b.api.post('/api/org/departments', { name: 'B dept' })).body;
    expect(
      (await a.api.post('/api/org/chart/move', { userId: a.owner.id, toDepartmentId: dept.id, mode: 'also' }))
        .status,
    ).toBe(404);
  });
});

describe('summary and search', () => {
  it('computes header cards and finds people', async () => {
    const { api } = await ownerClient(ctx.app);
    await api.post('/api/org/departments', { name: 'Quality' });
    await api.post('/api/org/users', { name: 'Kavita Rathore', mobile: rnd() });
    const s = (await api.get('/api/system/summary')).body;
    expect(s.company).toMatchObject({ people: 2, departments: 1, stepsTotal: 5 });
    expect(s.health.gaps.map((g: { key: string }) => g.key)).toContain('departmentsWithoutHod');
    const found = (await api.get('/api/search?q=kavita')).body;
    expect(found.people).toEqual([expect.objectContaining({ name: 'Kavita Rathore', code: 'EMP-002' })]);
  });
});
