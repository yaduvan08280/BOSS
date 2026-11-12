import { Readable } from 'node:stream';
import { createId } from '@paralleldrive/cuid2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from '../../lib/storage';
import { makeApp, testEnv } from '../../test/helpers';
import { FY, makeRecord, makeType, world } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const SITES = [
  { site: 'Tonk mine', cost: 500, kind: 'Survey', visit_on: '2026-11-05', urgent: true },
  { site: 'Niwai factory', cost: 1200, kind: 'Repair', visit_on: '2026-11-12' },
  { site: 'Kishangarh plant', cost: 90, kind: 'Repair', visit_on: '2026-12-01', urgent: false },
  { site: 'Ajmer depot', kind: 'Survey' },
  { site: 'Tonk quarry 2', cost: 7000, kind: 'Survey', visit_on: '2026-11-20', urgent: true },
];

async function seeded() {
  const w = await world(ctx.app);
  const typeId = await makeType(w.api);
  const recs = [];
  for (const data of SITES) recs.push(await makeRecord(w.api, typeId, data));
  await w.api.post(`/api/records/entries/${recs[1]!.id}/move`, { action: 'visit' });
  await w.api.post(`/api/records/entries/${recs[4]!.id}/move`, { action: 'visit' });
  const list = async (query: Record<string, unknown> = {}, api = w.api) => {
    const qs = new URLSearchParams(
      Object.entries(query).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
    );
    return api.get(`/api/records/types/${typeId}/records?${qs}`);
  };
  const sites = async (query: Record<string, unknown> = {}) =>
    ((await list(query)).body.rows as { title: string }[]).map((r) => r.title);
  return { w, typeId, recs, list, sites };
}

describe('record lists', () => {
  it('U4: search, status, date range, filters by any field, sort and paging all run on the server', async () => {
    const { list, sites } = await seeded();
    // Newest first by default; counts per status ignore the status filter itself.
    const all = (await list()).body;
    expect(all.total).toBe(5);
    expect(all.rows[0]).toMatchObject({ code: `SV/${FY}/0005`, title: 'Tonk quarry 2', status: 'visited' });
    expect(all.rows[0].createdBy).toBe('Test Owner');
    expect(all.counts).toEqual({ planned: 3, visited: 2 });
    expect(all.columns).toEqual(['code', 'title', 'status', 'site', 'visit_on', 'cost', 'kind', 'createdAt']);

    // Search: the number, the title, any value — never the field keys.
    expect(await sites({ q: 'tonk' })).toEqual(['Tonk quarry 2', 'Tonk mine']);
    expect(await sites({ q: `SV/${FY}/0003` })).toEqual(['Kishangarh plant']);
    expect(await sites({ q: 'repair' })).toEqual(['Kishangarh plant', 'Niwai factory']);
    expect(await sites({ q: 'visit_on' })).toEqual([]);
    expect(await sites({ q: '100%' })).toEqual([]);
    // Status chips (several at once), with the counts unchanged.
    const visited = (await list({ status: 'visited', q: 'tonk' })).body;
    expect(visited.rows.map((r: { title: string }) => r.title)).toEqual(['Tonk quarry 2']);
    expect(visited.counts).toEqual({ planned: 1, visited: 1 });
    expect((await list({ status: 'planned,visited' })).body.total).toBe(5);
    expect((await list({ status: 'nope' })).status).toBe(400);
    // Made on: today is inside, tomorrow onwards is empty.
    const today = new Date().toISOString().slice(0, 10);
    expect((await list({ from: '2020-01-01', to: '2099-01-01' })).body.total).toBe(5);
    expect((await list({ from: '2099-01-01' })).body.total).toBe(0);
    expect((await list({ to: '2020-01-01' })).body.total).toBe(0);
    expect((await list({ from: today.slice(0, 8) + '01' })).body.total).toBe(5);

    // Filters by a field's value, each in the way its type allows.
    const by = (field: string, op: string, value?: string) => sites({ filters: [{ field, op, value }] });
    expect(await by('kind', 'eq', 'repair')).toEqual(['Kishangarh plant', 'Niwai factory']);
    expect(await by('site', 'contains', 'TONK')).toEqual(['Tonk quarry 2', 'Tonk mine']);
    expect(await by('cost', 'gte', '500')).toEqual(['Tonk quarry 2', 'Niwai factory', 'Tonk mine']);
    expect(await by('cost', 'lte', '500')).toEqual(['Kishangarh plant', 'Tonk mine']);
    expect(await by('cost', 'eq', '1,200')).toEqual(['Niwai factory']);
    expect(await by('visit_on', 'gte', '2026-11-12')).toEqual([
      'Tonk quarry 2',
      'Kishangarh plant',
      'Niwai factory',
    ]);
    expect(await by('visit_on', 'lte', '2026-11-12')).toEqual(['Niwai factory', 'Tonk mine']);
    expect(await by('urgent', 'eq', 'yes')).toEqual(['Tonk quarry 2', 'Tonk mine']);
    expect(await by('urgent', 'eq', 'no')).toEqual(['Kishangarh plant']);
    expect(await by('cost', 'empty')).toEqual(['Ajmer depot']);
    expect(await by('visit_on', 'filled')).toHaveLength(4);
    expect(
      await sites({
        filters: [
          { field: 'kind', op: 'eq', value: 'Survey' },
          { field: 'cost', op: 'gte', value: '600' },
        ],
      }),
    ).toEqual(['Tonk quarry 2']);
    // Wrong filters are named, never a silent empty list — and nothing typed becomes SQL.
    for (const filters of [
      [{ field: 'nope', op: 'eq', value: 'x' }],
      [{ field: 'cost', op: 'gte', value: 'cheap' }],
      [{ field: 'cost', op: 'contains', value: '5' }],
      [{ field: 'kind', op: 'eq' }],
    ])
      expect((await list({ filters })).status).toBe(400);
    expect((await list({ filters: 'not json' })).status).toBe(400);
    expect(await by('site', 'eq', "x' OR '1'='1")).toEqual([]);
    expect(await sites({ q: "'; DROP TABLE records; --" })).toEqual([]);

    // Sort by a number (empty last either way), by text, by the number series.
    expect(await sites({ sort: 'cost', dir: 'asc' })).toEqual([
      'Kishangarh plant',
      'Tonk mine',
      'Niwai factory',
      'Tonk quarry 2',
      'Ajmer depot',
    ]);
    expect((await sites({ sort: 'cost', dir: 'desc' }))[0]).toBe('Tonk quarry 2');
    expect((await sites({ sort: 'cost', dir: 'desc' })).at(-1)).toBe('Ajmer depot');
    expect((await sites({ sort: 'site', dir: 'asc' }))[0]).toBe('Ajmer depot');
    expect((await sites({ sort: 'title', dir: 'desc' }))[0]).toBe('Tonk quarry 2');
    expect((await sites({ sort: 'code', dir: 'asc' }))[0]).toBe('Tonk mine');
    expect((await list({ sort: 'nope' })).status).toBe(400);
    // Paging, and only the chosen columns travel.
    const p2 = (await list({ sort: 'code', dir: 'asc', page: '2', pageSize: '2', columns: 'code,cost' }))
      .body;
    expect(p2).toMatchObject({ page: 2, pageSize: 2, total: 5, columns: ['code', 'cost'] });
    expect(p2.rows.map((r: { code: string; data: object }) => [r.code, r.data])).toEqual([
      [`SV/${FY}/0003`, { cost: 90 }],
      [`SV/${FY}/0004`, {}],
    ]);
    expect((await list({ page: '9' })).body.rows).toEqual([]);
  });

  it('U4: saved views are mine or shared; sharing needs the right to edit; the drawer has notes, history and files', async () => {
    const { w, typeId, recs } = await seeded();
    await w.api.patch(`/api/records/types/${typeId}`, {
      permissions: { view: ['*'], create: ['*'], edit: [w.role('HOD')], approve: [w.role('HOD')] },
    });
    const gopal = await w.person('Gopal Prajapat');
    const hod = await w.person('Sunita Jain', 'HOD');
    const views = `/api/records/types/${typeId}/views`;
    const config = {
      q: 'tonk',
      status: ['visited'],
      filters: [{ field: 'cost', op: 'gte', value: '100' }],
      sort: 'cost',
      dir: 'desc',
      columns: ['code', 'site', 'cost'],
    };
    const mine = await gopal.api.post(views, { name: 'Costly Tonk', config });
    expect(mine.body).toMatchObject({ name: 'Costly Tonk', shared: false, mine: true, config });
    expect((await gopal.api.post(views, { name: 'For all', shared: true, config: {} })).status).toBe(403);
    const shared = (
      await hod.api.post(views, {
        name: 'Repairs',
        shared: true,
        config: { filters: [{ field: 'kind', op: 'eq', value: 'Repair' }] },
      })
    ).body;
    expect(((await gopal.api.get(views)).body as { name: string }[]).map((v) => v.name)).toEqual([
      'Repairs',
      'Costly Tonk',
    ]);
    expect(((await hod.api.get(views)).body as { name: string }[]).map((v) => v.name)).toEqual(['Repairs']);
    // Only its maker (or an admin) changes or removes a view.
    expect((await gopal.api.put(`${views}/${shared.id}`, { name: 'Mine now', config: {} })).status).toBe(403);
    expect((await gopal.api.del(`${views}/${shared.id}`)).status).toBe(403);
    expect(
      (await gopal.api.put(`${views}/${mine.body.id}`, { name: 'Costly', config: { q: 'niwai' } })).body,
    ).toMatchObject({ name: 'Costly', config: { q: 'niwai' } });
    expect((await w.api.del(`${views}/${shared.id}`)).status).toBe(200);
    expect((await gopal.api.del(`${views}/${mine.body.id}`)).status).toBe(200);
    expect((await gopal.api.get(views)).body).toEqual([]);

    const detail = (await gopal.api.get(`/api/records/entries/${recs[0]!.id}`)).body;
    expect(detail.can).toEqual({ edit: false, files: false, delete: false });
    expect(detail.files).toEqual([]);
    expect(detail.type.permissions).toBeUndefined();
    expect((await hod.api.get(`/api/records/entries/${recs[0]!.id}`)).body.can).toEqual({
      edit: true,
      files: true,
      delete: true,
    });

    // Files: uploaded, attached to the record by someone who may edit, listed in the drawer, taken off again.
    const storage = new LocalDiskStorage(testEnv().UPLOAD_DIR);
    const upload = async (userId: string) => {
      const id = createId();
      const path = `${w.companyId}/test/${id}.json`;
      await storage.put(path, Readable.from([Buffer.from('{"proof":true}')]));
      await ctx.prisma.attachment.create({
        data: {
          id,
          companyId: w.companyId,
          entityType: 'upload',
          entityId: userId,
          path,
          mime: 'application/pdf',
          size: 14,
          originalName: 'visit report.pdf',
          uploadedById: userId,
        },
      });
      return id;
    };
    const files = `/api/records/entries/${recs[0]!.id}/files`;
    const hers = await upload(hod.id);
    expect((await gopal.api.post(files, { ids: [await upload(gopal.id)] })).status).toBe(403);
    // Someone else's upload can't be attached.
    expect((await hod.api.post(files, { ids: [await upload(gopal.id)] })).status).toBe(400);
    expect((await hod.api.post(files, { ids: [hers] })).body).toEqual({ added: 1 });
    const withFile = (await gopal.api.get(`/api/records/entries/${recs[0]!.id}`)).body;
    expect(withFile.files).toMatchObject([
      { id: hers, name: 'visit report.pdf', url: `/api/files/${hers}`, inField: false },
    ]);
    expect(withFile.events.at(-1)).toMatchObject({
      type: 'file',
      by: 'Sunita Jain',
      data: { files: ['visit report.pdf'] },
    });
    // The file opens for people who can see the record — and for nobody else once the type is closed to them.
    expect((await gopal.api.get(`/api/files/${hers}`)).body).toEqual({ proof: true });
    await w.api.patch(`/api/records/types/${typeId}`, {
      permissions: { view: [w.role('HOD')], create: [], edit: [w.role('HOD')], approve: [] },
    });
    expect((await gopal.api.get(`/api/files/${hers}`)).status).toBe(403);
    expect((await hod.api.get(`/api/files/${hers}`)).status).toBe(200);
    expect((await gopal.api.del(`${files}/${hers}`)).status).toBe(403);
    expect((await hod.api.del(`${files}/${hers}`)).status).toBe(200);
    expect((await hod.api.get(`/api/records/entries/${recs[0]!.id}`)).body.files).toEqual([]);
    expect((await hod.api.get(`/api/files/${hers}`)).status).toBe(404);
  });
});
