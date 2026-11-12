import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';
import { actorFor } from '../work/actor';
import { importSheet } from './rows';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;

async function setup() {
  const o = await ownerClient(ctx.app);
  const mobile = rnd();
  const r = (await o.api.post('/api/org/users', { name: 'Gopal Prajapat', mobile, loginEnabled: true })).body;
  const member = await signedIn(ctx.app, mobile, r.tempPassword);
  await member.post('/api/auth/change-password', {
    currentPassword: r.tempPassword,
    newPassword: 'Gopal12345',
  });
  const vendors = (await o.api.post('/api/masters/library/vendors', {})).body as { id: string };
  return { ...o, member, vendors, companyId: o.company.id };
}

describe('masters', () => {
  it('a library master is made once; rows have unique keys; deleting frees the key', async () => {
    const s = await setup();
    expect(s.vendors.id).toBeTruthy();
    expect((await s.api.post('/api/masters/library/vendors', {})).status).toBe(409);
    const lib = (await s.api.get('/api/masters/library')).body as { key: string; have: boolean }[];
    expect(lib.find((l) => l.key === 'vendors')!.have).toBe(true);
    const a = await s.api.post(`/api/masters/${s.vendors.id}/rows`, {
      code: 'V-001',
      name: 'Shree Minerals',
      mobile: '9829012345',
      terms: '30',
    });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ key: 'V-001', label: 'Shree Minerals' });
    // Same code again: refused. Missing name (required): refused. Bad mobile: refused.
    expect(
      (await s.api.post(`/api/masters/${s.vendors.id}/rows`, { code: 'V-001', name: 'Copy' })).status,
    ).toBe(409);
    expect((await s.api.post(`/api/masters/${s.vendors.id}/rows`, { code: 'V-002' })).status).toBe(400);
    expect(
      (await s.api.post(`/api/masters/${s.vendors.id}/rows`, { code: 'V-003', name: 'X', mobile: '123' }))
        .status,
    ).toBe(400);
    // A member reads but can't change.
    expect((await s.member.get(`/api/masters/${s.vendors.id}/rows`)).body.rows).toHaveLength(1);
    expect(
      (await s.member.post(`/api/masters/${s.vendors.id}/rows`, { code: 'V-9', name: 'Nope' })).status,
    ).toBe(403);
    await s.api.del(`/api/masters/${s.vendors.id}/rows/${a.body.id}`);
    expect(
      (await s.api.post(`/api/masters/${s.vendors.id}/rows`, { code: 'V-001', name: 'Shree Minerals Ajmer' }))
        .status,
    ).toBe(200);
  });

  it('import: headings by label or key, DD/MM/YYYY dates, all or nothing with every problem by line', async () => {
    const s = await setup();
    const docs = (await s.api.post('/api/masters/library/documents', {})).body as { id: string };
    const bad = await s.api.post(`/api/masters/${docs.id}/import`, {
      table: [
        ['Document', 'Number', 'Valid till'],
        ['Factory licence', 'FL-22', '31/03/2027'],
        ['', 'X', ''],
        ['Pollution NOC', 'PN-9', '31/02/2027'],
        ['Factory licence', 'again', ''],
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.lines.map((l: { line: number }) => l.line).sort()).toEqual([3, 4, 5]);
    expect((await s.api.get(`/api/masters/${docs.id}/rows`)).body.total).toBe(0);
    const ok = await s.api.post(`/api/masters/${docs.id}/import`, {
      table: [
        ['name', 'number', 'Valid till'],
        ['Factory licence', 'FL-22', '31/03/2027'],
        ['Fire NOC', 'FN-3', '2027-01-15'],
      ],
    });
    expect(ok.body).toEqual({ created: 2 });
    const rows = (await s.api.get(`/api/masters/${docs.id}/rows`)).body.rows as {
      label: string;
      data: { valid_till: string };
    }[];
    expect(rows.find((r) => r.label === 'Factory licence')!.data.valid_till).toBe('2027-03-31');
  });

  it('a Google Sheet link: only docs.google.com, its CSV export, shared sheets only', async () => {
    const s = await setup();
    const owner = (await actorFor(
      ctx.prisma,
      s.companyId,
      (await ctx.prisma.user.findFirstOrThrow({ where: { companyId: s.companyId, role: { key: 'OWNER' } } }))
        .id,
    ))!;
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(url);
      return new Response('Vendor code,Vendor name\nV-10,Rajasthan Silica\nV-11,Polyrocks', { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      importSheet(ctx.prisma, owner, s.vendors.id, 'https://evil.example.com/spreadsheets/d/abc', fake),
    ).rejects.toThrow(/Google Sheet/);
    const r = await importSheet(
      ctx.prisma,
      owner,
      s.vendors.id,
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=42',
      fake,
    );
    expect(r).toEqual({ created: 2 });
    expect(seen).toEqual([
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/export?format=csv&gid=42',
    ]);
    const html = (async () =>
      new Response('<!DOCTYPE html><html>Sign in</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(
      importSheet(
        ctx.prisma,
        owner,
        s.vendors.id,
        'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit',
        html,
      ),
    ).rejects.toThrow(/not shared/);
  });

  it('"from a master" options: people, items, customers, vendors and custom masters, searchable', async () => {
    const s = await setup();
    await s.api.post(`/api/masters/${s.vendors.id}/rows`, { code: 'V-1', name: 'Shree Minerals' });
    await s.api.post(`/api/masters/${s.vendors.id}/rows`, { code: 'V-2', name: 'Polyrocks Vadodara' });
    await s.api.post('/api/ims/items', { code: 'RM-1', name: 'Polyester resin', unit: 'kg' });
    await s.api.post('/api/crm/customers', { name: 'Shree Ram Tiles', city: 'Ajmer' });
    const opt = async (source: string, q = '') =>
      (await s.member.get(`/api/masters/options?source=${encodeURIComponent(source)}&q=${q}`)).body;
    // Each choice also carries the link to its row and the row's columns (phase 11: auto-fill, dependent choices).
    expect(await opt('vendors', 'poly')).toEqual([
      {
        value: 'Polyrocks Vadodara',
        label: 'Polyrocks Vadodara',
        sub: 'V-2',
        ref: expect.stringMatching(/^row:/),
        columns: { code: 'V-2', name: 'Polyrocks Vadodara' },
      },
    ]);
    expect(await opt(`m:${s.vendors.id}`)).toHaveLength(2);
    expect(await opt('items', 'rm-1')).toMatchObject([
      {
        value: 'Polyester resin',
        label: 'Polyester resin',
        sub: 'RM-1 · kg',
        ref: expect.stringMatching(/^item:/),
        columns: { code: 'RM-1', unit: 'kg', stock: 0 },
      },
    ]);
    expect((await opt('customers', 'shree'))[0]).toMatchObject({
      value: 'Shree Ram Tiles',
      sub: expect.stringContaining('Ajmer'),
    });
    expect((await opt('people', 'gopal')).map((p: { value: string }) => p.value)).toEqual(['Gopal Prajapat']);
    expect((await s.member.get('/api/masters/options?source=nope')).status).toBe(400);
  });
});
