import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckDigit } from '@mono/shared';
import { makeApp, ownerClient } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp({ GST_API_PROVIDER: 'mock' });
});
afterAll(async () => ctx.app.close());

const validGstin = () => {
  const first = '08AAACG1234A1Z';
  return first + gstinCheckDigit(first);
};

describe('company profile', () => {
  it('saves the profile, checks the GSTIN and fills the PAN', async () => {
    const { api } = await ownerClient(ctx.app);
    const base = {
      name: 'GGM Minerals',
      city: 'Kishangarh',
      state: 'Rajasthan',
      ownerName: 'Owner',
      mobile: '9829012345',
    };
    expect((await api.put('/api/org/company', { ...base, gstin: '08AAACG1234A1ZZ' })).status).toBe(400);
    const ok = await api.put('/api/org/company', { ...base, gstin: validGstin().toLowerCase(), email: '' });
    expect(ok.status).toBe(200);
    expect(ok.body.profile).toMatchObject({
      gstin: validGstin(),
      pan: 'AAACG1234A',
      mobile: '+919829012345',
    });
    const verify = await api.post('/api/org/company/gst-verify', { gstin: validGstin() });
    expect(verify.body).toMatchObject({ valid: true, stateName: 'Rajasthan', provider: 'mock' });
    expect(verify.body.legalName).toContain('Pvt Ltd');
  });

  it('manages points of contact', async () => {
    const { api } = await ownerClient(ctx.app);
    const c = await api.post('/api/org/contacts', { role: 'Accounts', name: 'Ravi', phone: '9829000000' });
    expect(c.status).toBe(200);
    expect((await api.patch(`/api/org/contacts/${c.body.id}`, { name: 'Ravi Kumar' })).body.name).toBe(
      'Ravi Kumar',
    );
    expect((await api.del(`/api/org/contacts/${c.body.id}`)).status).toBe(200);
    expect((await api.get('/api/org/company')).body.contacts).toHaveLength(0);
  });

  it('saves appearance and shows it in /me', async () => {
    const { api } = await ownerClient(ctx.app);
    const look = {
      appName: 'GGM One',
      theme: { seed: '#1F3A5F', warmth: 30, radius: 10, sidebar: 'light', buttons: 'ink' },
      defaultLang: 'hi',
      defaultThemeMode: 'dark',
      staffMayPickAccent: true,
      logoFileId: null,
    };
    expect((await api.put('/api/org/appearance', look)).status).toBe(200);
    const me = (await api.get('/api/auth/me')).body;
    expect(me.company).toMatchObject({ appName: 'GGM One', defaultLang: 'hi', staffMayPickAccent: true });
    expect(me.company.theme.seed).toBe('#1F3A5F');
  });
});

describe('shifts, branches, designations', () => {
  it('handles overnight shifts and one default', async () => {
    const { api } = await ownerClient(ctx.app);
    const night = await api.post('/api/org/shifts', {
      name: 'Night',
      start: '23:00',
      end: '07:00',
      weekdays: [1, 2, 3, 4, 5, 6],
      isDefault: true,
    });
    expect(night.body).toMatchObject({ overnight: true, start: '23:00', isDefault: true });
    const shifts = (await api.get('/api/org/shifts')).body as { isDefault: boolean }[];
    expect(shifts.filter((s) => s.isDefault)).toHaveLength(1);
    expect((await api.del(`/api/org/shifts/${night.body.id}`)).status).toBe(409);
    expect(
      (await api.post('/api/org/shifts', { name: 'Bad', start: '25:00', end: '07:00', weekdays: [1] }))
        .status,
    ).toBe(400);
  });

  it('builds a branch tree and refuses loops', async () => {
    const { api } = await ownerClient(ctx.app);
    const plant = (await api.post('/api/org/branches', { name: 'Kishangarh plant', code: 'KSG' })).body;
    expect(plant.isDefault).toBe(true);
    const mine = (await api.post('/api/org/branches', { name: 'Tonk mines', parentId: plant.id })).body;
    expect((await api.patch(`/api/org/branches/${plant.id}`, { parentId: mine.id })).status).toBe(400);
    expect((await api.del(`/api/org/branches/${plant.id}`)).status).toBe(409);
    expect((await api.del(`/api/org/branches/${mine.id}`)).status).toBe(200);
  });

  it('keeps designations unique and only deletes unused ones', async () => {
    const { api } = await ownerClient(ctx.app);
    const fitter = (await api.post('/api/org/designations', { name: 'Fitter' })).body;
    expect((await api.post('/api/org/designations', { name: 'fitter' })).status).toBe(409);
    await api.post('/api/org/users', { name: 'Sandeep Pal', designationId: fitter.id });
    expect((await api.del(`/api/org/designations/${fitter.id}`)).status).toBe(409);
  });
});

describe('departments and org chart', () => {
  it('nests departments, blocks loops and non-empty deletes', async () => {
    const { api } = await ownerClient(ctx.app);
    const maint = (await api.post('/api/org/departments', { name: 'Maintenance' })).body;
    const elec = (await api.post('/api/org/departments', { name: 'Electrical', parentId: maint.id })).body;
    expect((await api.patch(`/api/org/departments/${maint.id}`, { parentId: elec.id })).status).toBe(400);
    expect((await api.del(`/api/org/departments/${maint.id}`)).status).toBe(409);
    await api.post('/api/org/users', { name: 'Ajay', mainDepartmentId: elec.id });
    expect((await api.del(`/api/org/departments/${elec.id}`)).status).toBe(409);
  });

  it('moves people, adds them to a second department and makes a HOD', async () => {
    const { api } = await ownerClient(ctx.app);
    const maint = (await api.post('/api/org/departments', { name: 'Maintenance' })).body;
    const it = (await api.post('/api/org/departments', { name: 'IT' })).body;
    const sandeep = (await api.post('/api/org/users', { name: 'Sandeep Pal', mainDepartmentId: maint.id }))
      .body.person;

    await api.post('/api/org/chart/move', {
      userId: sandeep.id,
      toDepartmentId: it.id,
      mode: 'also',
      fromDepartmentId: maint.id,
    });
    let p = ((await api.get('/api/org/users')).body as { id: string }[]).find(
      (u) => u.id === sandeep.id,
    ) as Record<string, unknown>;
    expect(p).toMatchObject({ mainDepartmentId: maint.id, alsoWorksIn: [it.id] });

    await api.post('/api/org/chart/move', {
      userId: sandeep.id,
      toDepartmentId: it.id,
      mode: 'move',
      fromDepartmentId: maint.id,
    });
    p = ((await api.get('/api/org/users')).body as { id: string }[]).find(
      (u) => u.id === sandeep.id,
    ) as Record<string, unknown>;
    expect(p).toMatchObject({ mainDepartmentId: it.id, alsoWorksIn: [] });

    await api.post('/api/org/chart/move', { userId: sandeep.id, toDepartmentId: maint.id, mode: 'hod' });
    const depts = (await api.get('/api/org/departments')).body as {
      id: string;
      hodUserId: string;
      peopleCount: number;
    }[];
    expect(depts.find((d) => d.id === maint.id)).toMatchObject({ hodUserId: sandeep.id, peopleCount: 1 });
  });
});

describe('roles', () => {
  it('protects built-in roles and checks permission keys', async () => {
    const { api } = await ownerClient(ctx.app);
    const { roles } = (await api.get('/api/org/roles')).body as {
      roles: { id: string; key: string | null }[];
    };
    const owner = roles.find((r) => r.key === 'OWNER')!;
    const hod = roles.find((r) => r.key === 'HOD')!;
    expect((await api.patch(`/api/org/roles/${owner.id}`, { permissions: [] })).status).toBe(409);
    expect(
      (await api.patch(`/api/org/roles/${hod.id}`, { permissions: ['org.view', 'delegation.view'] })).status,
    ).toBe(200);
    expect((await api.post('/api/org/roles', { name: 'Store', permissions: ['ims.fly'] })).status).toBe(400);
    const store = (
      await api.post('/api/org/roles', { name: 'Store', permissions: ['ims.view', 'ims.create'] })
    ).body;
    await api.post('/api/org/users', { name: 'Store Keeper', roleId: store.id });
    expect((await api.del(`/api/org/roles/${store.id}`)).status).toBe(409);
    expect((await api.del(`/api/org/roles/${hod.id}`)).status).toBe(409);
  });
});
