import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asHeader, cookieHeader, makeApp, ORIGIN } from '../../test/helpers';
import { FY, makeRecord, makeType, siteVisit, world } from './testkit';
import { toXlsx } from './xlsx';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/** The files inside a zip, by name (enough of the format to read back what `toXlsx` wrote). */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (let at = 0; buf.readUInt32LE(at) === 0x04034b50;) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const start = at + 30 + nameLen + buf.readUInt16LE(at + 28);
    out[buf.toString('utf8', at + 30, at + 30 + nameLen)] = inflateRawSync(
      buf.subarray(start, start + size),
    ).toString();
    at = start + size;
  }
  return out;
}

/** A download as the browser gets it (the test client only reads JSON). */
async function download(mobile: string, password: string, url: string) {
  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: ORIGIN },
    payload: { identifier: mobile, password },
  });
  const res = await ctx.app.inject({
    method: 'GET',
    url,
    headers: { cookie: asHeader(cookieHeader(login)) },
  });
  return { status: res.statusCode, headers: res.headers, text: res.body, raw: res.rawPayload };
}

describe('record import, export and menu', () => {
  it('U5: import is all or nothing with every problem by line; imported records take the next numbers', async () => {
    const w = await world(ctx.app);
    const typeId = await makeType(w.api);
    await makeRecord(w.api, typeId, { site: 'Tonk mine' });
    const imp = (table: string[][], api = w.api) =>
      api.post(`/api/records/types/${typeId}/import`, { table });
    const bad = await imp([
      ['Site', 'Visit on', 'Cost', 'Kind', 'Urgent', 'Not a field'],
      ['Niwai factory', '12/11/2026', '1,200', 'Repair', 'yes', 'x'],
      ['', '31/02/2026', 'lots', 'Holiday', '', ''],
      ['', '', '', '', '', ''],
      ['Ajmer depot', '', '', 'Survey', 'maybe', ''],
    ]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('5 problem(s) to fix');
    expect(bad.body.error.details.lines).toEqual([
      { line: 3, error: 'Site is required' },
      { line: 3, error: 'Visit on: use a DD/MM/YYYY date' },
      { line: 3, error: 'Cost must be a number' },
      { line: 3, error: 'Kind: pick from the list' },
      { line: 5, error: 'Urgent: choose yes or no' },
    ]);
    // Nothing was saved, and no number was used up.
    expect((await w.api.get(`/api/records/types/${typeId}/records`)).body.total).toBe(1);
    expect((await imp([['Site']])).status).toBe(400);
    expect((await imp([['Colour'], ['Red']])).body.error.message).toMatch(
      /The first row should name the fields: Site,/,
    );

    const ok = await imp([
      ['site', 'Visit on*', 'Cost:', 'kind', 'Urgent'],
      ['Niwai factory', '12/11/2026', '1,200', 'Repair', 'yes'],
      ['', '', '', '', ''],
      ['Ajmer depot', '2026-12-01', '', 'Survey', 'No'],
    ]);
    expect(ok.body).toEqual({ created: 2, from: `SV/${FY}/0002`, to: `SV/${FY}/0003` });
    const rows = (
      await w.api.get(
        `/api/records/types/${typeId}/records?sort=code&dir=asc&columns=site,visit_on,cost,urgent`,
      )
    ).body.rows;
    expect(
      rows.map((r: { code: string; status: string; data: object }) => [r.code, r.status, r.data]),
    ).toEqual([
      [`SV/${FY}/0001`, 'planned', { site: 'Tonk mine' }],
      [
        `SV/${FY}/0002`,
        'planned',
        { site: 'Niwai factory', visit_on: '2026-11-12', cost: 1200, urgent: true },
      ],
      [`SV/${FY}/0003`, 'planned', { site: 'Ajmer depot', visit_on: '2026-12-01', urgent: false }],
    ]);
    expect((await makeRecord(w.api, typeId, { site: 'After the import' })).code).toBe(`SV/${FY}/0004`);
    const event = await ctx.prisma.domainEvent.findFirst({
      where: { companyId: w.companyId, name: 'record.imported' },
    });
    expect(event!.payload).toMatchObject({ count: 2, type: 'Site visit', from: `SV/${FY}/0002` });
    // Importing makes records: it needs the right to create, and a type that is in use.
    await w.api.patch(`/api/records/types/${typeId}`, {
      permissions: { view: ['*'], create: [w.role('HOD')], edit: ['*'], approve: [] },
    });
    const gopal = await w.person('Gopal Prajapat');
    expect((await imp([['Site'], ['Sneaky']], gopal.api)).status).toBe(403);
    await w.api.post(`/api/records/types/${typeId}/archive`);
    expect((await imp([['Site'], ['Too late']])).status).toBe(409);
  });

  it('U5: the current list exports as CSV and as Excel, with the same filters, readable dates and labels', async () => {
    const w = await world(ctx.app);
    const typeId = await makeType(w.api);
    await makeRecord(w.api, typeId, {
      site: 'Tonk mine',
      cost: 500,
      kind: 'Survey',
      visit_on: '2026-11-05',
      urgent: true,
    });
    const b = await makeRecord(w.api, typeId, {
      site: '=cmd|calc',
      cost: 1200.5,
      kind: 'Repair',
      visit_on: '2026-12-01',
    });
    await makeRecord(w.api, typeId, { site: 'टोंक खदान', kind: 'Repair' });
    await w.api.post(`/api/records/entries/${b.id}/move`, { action: 'visit' });
    const base = `/api/records/types/${typeId}/export`;

    const csv = await download(
      w.mobile,
      w.password,
      `${base}?sort=code&dir=asc&columns=code,site,status,cost,visit_on,urgent`,
    );
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="site_visit.csv"');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text.slice(1).split('\r\n')).toEqual([
      '"Number","Site","Status","Cost","Visit on","Urgent"',
      `"SV/${FY}/0001","Tonk mine","Planned","500","05/11/2026","Yes"`,
      // Text that looks like a formula is kept as text.
      `"SV/${FY}/0002","'=cmd|calc","Visited","1200.5","01/12/2026",""`,
      `"SV/${FY}/0003","टोंक खदान","Planned","","",""`,
    ]);
    // The same filters as the screen; `all` adds every field and who made it.
    const filters = encodeURIComponent(JSON.stringify([{ field: 'kind', op: 'eq', value: 'Repair' }]));
    const some = await download(w.mobile, w.password, `${base}?filters=${filters}&status=visited&all=1`);
    const lines = some.text.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      '"Number","Title","Status","Site","Visit on","Cost","Kind","Urgent","Made on","Made by"',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^"SV\/.*\/0002","'=cmd\|calc","Visited",.*"Test Owner"$/);

    const xlsx = await download(
      w.mobile,
      w.password,
      `${base}?format=xlsx&sort=code&dir=asc&columns=code,site,cost`,
    );
    expect(xlsx.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(xlsx.headers['content-disposition']).toBe('attachment; filename="site_visit.xlsx"');
    const sheet = unzip(xlsx.raw)['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('<t xml:space="preserve">Site</t>');
    expect(sheet).toContain(`<t xml:space="preserve">SV/${FY}/0001</t>`);
    expect(sheet).toContain('<c r="C3"><v>1200.5</v></c>');
    expect(sheet).toContain('<t xml:space="preserve">=cmd|calc</t>');
    // No right to see the type: no export.
    await w.api.patch(`/api/records/types/${typeId}`, {
      permissions: { view: [w.role('HOD')], create: [], edit: [], approve: [] },
    });
    const gopal = await w.person('Gopal Prajapat');
    expect((await gopal.api.get(`${base}?format=csv`)).status).toBe(403);
  });

  it('U5: the Excel writer makes a real .xlsx (a zip of the sheet XML) and keeps typed text as text', () => {
    const file = toXlsx('Site visits: 2026/27', [
      ['Number', 'Site', 'Cost'],
      ['SV/26-27/0001', '=SUM(A1) & <b>', 1250.5],
      ['SV/26-27/0002', 'टोंक खदान', null],
    ]);
    const parts = unzip(file);
    expect(Object.keys(parts)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(parts['xl/workbook.xml']).toContain('<sheet name="Site visits  2026 27"');
    const sheet = parts['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Number</t></is></c>');
    expect(sheet).toContain(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">=SUM(A1) &amp; &lt;b&gt;</t></is></c>',
    );
    expect(sheet).toContain('<c r="C2"><v>1250.5</v></c>');
    expect(sheet).toContain('टोंक खदान');
    expect(sheet).not.toContain('r="C3"');
  });

  it('U5: the admin places a type in the left menu; each person gets the entries they may see', async () => {
    const w = await world(ctx.app);
    const visits = await makeType(w.api);
    const trips = await makeType(
      w.api,
      siteVisit({
        name: 'Trip',
        pluralName: 'Trips',
        prefix: 'TR',
        menu: { section: 'Transport', icon: 'truck' },
        permissions: { view: [w.role('HOD')], create: [w.role('HOD')], edit: [w.role('HOD')], approve: [] },
      }),
    );
    await makeType(
      w.api,
      siteVisit({ name: 'Log', pluralName: 'Logs', prefix: 'LOG', menu: { section: null, icon: 'folder' } }),
    );
    const gopal = await w.person('Gopal Prajapat');
    const hod = await w.person('Sunita Jain', 'HOD');
    expect((await gopal.api.get('/api/records/menu')).body).toEqual([
      { id: visits, name: 'Site visits', section: 'systems', icon: 'map-pin', path: `/records/${visits}` },
    ]);
    expect((await hod.api.get('/api/records/menu')).body).toEqual([
      { id: visits, name: 'Site visits', section: 'systems', icon: 'map-pin', path: `/records/${visits}` },
      { id: trips, name: 'Trips', section: 'Transport', icon: 'truck', path: `/records/${trips}` },
    ]);
    // Moved, hidden, archived: the menu follows.
    await w.api.patch(`/api/records/types/${visits}`, { menu: { section: 'Field work', icon: 'hammer' } });
    expect((await gopal.api.get('/api/records/menu')).body[0]).toMatchObject({
      section: 'Field work',
      icon: 'hammer',
    });
    await w.api.patch(`/api/records/types/${visits}`, { menu: { section: null, icon: 'hammer' } });
    expect((await gopal.api.get('/api/records/menu')).body).toEqual([]);
    await w.api.post(`/api/records/types/${trips}/archive`);
    expect((await hod.api.get('/api/records/menu')).body).toEqual([]);
    expect(
      (await w.api.patch(`/api/records/types/${trips}`, { menu: { section: 'x', icon: 'skull' } })).status,
    ).toBe(400);
    // The types list: people see what they may view (archived ones only for admins).
    const names = async (api: typeof w.api) =>
      ((await api.get('/api/records/types')).body.types as { name: string }[]).map((t) => t.name);
    expect(await names(gopal.api)).toEqual(['Log', 'Site visit']);
    expect(await names(hod.api)).toEqual(['Log', 'Site visit']);
    expect(await names(w.api)).toEqual(['Log', 'Site visit', 'Trip']);
  });
});
