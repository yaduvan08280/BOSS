import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { makeRecord, makeType, siteVisit, world, type Client } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/** Members see; supervisors also make and change; heads of department see and approve; the EA sees nothing. */
async function guarded() {
  const w = await world(ctx.app);
  const [MEMBER, SUPERVISOR, HOD] = [w.role('MEMBER'), w.role('SUPERVISOR'), w.role('HOD')];
  const typeId = await makeType(
    w.api,
    siteVisit({
      permissions: {
        view: [MEMBER, SUPERVISOR, HOD],
        create: [SUPERVISOR],
        edit: [SUPERVISOR],
        approve: [HOD],
      },
    }),
  );
  const rec = await makeRecord(w.api, typeId, { site: 'Tonk mine', cost: 500 });
  return {
    w,
    typeId,
    rec,
    member: (await w.person('Gopal Member')).api,
    supervisor: (await w.person('Ravi Supervisor', 'SUPERVISOR')).api,
    hod: (await w.person('Sunita Hod', 'HOD')).api,
    ea: (await w.person('Meena Ea', 'EA')).api,
    admin: (await w.person('Nikhil Admin', 'ADMIN')).api,
  };
}

describe('permissions per record type', () => {
  it('U6: view — every reading route is closed to people the type does not name', async () => {
    const { typeId, rec, member, ea, w } = await guarded();
    const reads = [
      `/api/records/types/${typeId}`,
      `/api/records/types/${typeId}/records`,
      `/api/records/types/${typeId}/records?q=tonk&sort=cost`,
      `/api/records/types/${typeId}/export?format=xlsx`,
      `/api/records/types/${typeId}/views`,
      `/api/records/entries/${rec.id}`,
      `/api/masters/options?source=rt:${typeId}`,
    ];
    for (const url of reads) {
      const res = await ea.get(url);
      expect([url, res.status]).toEqual([url, 403]);
      expect(res.body.error.message).toBe("You can't see site visits");
    }
    for (const url of reads.filter((u) => !u.includes('/export')))
      expect([url, (await member.get(url)).status]).toEqual([url, 200]);
    // Nothing about the type leaks through the lists either.
    expect((await ea.get('/api/records/types')).body.types).toEqual([]);
    expect((await ea.get('/api/records/menu')).body).toEqual([]);
    expect((await member.get('/api/records/menu')).body).toHaveLength(1);
    // Writing a note or saving a view needs sight of the record too.
    expect((await ea.post(`/api/records/entries/${rec.id}/notes`, { note: 'hello' })).status).toBe(403);
    expect((await ea.post(`/api/records/types/${typeId}/views`, { name: 'x', config: {} })).status).toBe(403);
    expect((await member.post(`/api/records/entries/${rec.id}/notes`, { note: 'hello' })).status).toBe(200);
    // Who may do what is shown only to the people who set the type up.
    expect((await member.get(`/api/records/types/${typeId}`)).body.permissions).toBeUndefined();
    expect((await member.get(`/api/records/types/${typeId}`)).body.access).toMatchObject({
      view: true,
      create: false,
      edit: false,
      approve: false,
      admin: false,
    });
    expect((await w.api.get(`/api/records/types/${typeId}`)).body.permissions.approve).toEqual([
      w.role('HOD'),
    ]);
  });

  it('U6: create and edit — making, importing, changing, deleting and attaching follow the type', async () => {
    const { typeId, rec, member, supervisor, hod } = await guarded();
    const create = (api: Client) =>
      api.post(`/api/records/types/${typeId}/records`, { data: { site: 'New' } });
    const imp = (api: Client) =>
      api.post(`/api/records/types/${typeId}/import`, { table: [['Site'], ['Imp']] });
    const change = (api: Client) =>
      api.patch(`/api/records/entries/${rec.id}`, { data: { site: 'Changed' } });
    const attach = (api: Client) => api.post(`/api/records/entries/${rec.id}/files`, { ids: ['nothing'] });
    for (const api of [member, hod]) {
      expect((await create(api)).status).toBe(403);
      expect((await imp(api)).status).toBe(403);
      expect((await change(api)).status).toBe(403);
      expect((await attach(api)).status).toBe(403);
      expect((await api.del(`/api/records/entries/${rec.id}/files/nothing`)).status).toBe(403);
      expect((await api.del(`/api/records/entries/${rec.id}`)).status).toBe(403);
    }
    expect((await create(member)).body.error.message).toBe("You can't add site visits");
    expect((await change(member)).body.error.message).toBe("You can't change site visits");
    expect((await create(supervisor)).status).toBe(200);
    expect((await imp(supervisor)).body.created).toBe(1);
    expect((await change(supervisor)).body.changed).toEqual(['Site', 'Cost']);
    expect((await attach(supervisor)).status).toBe(400); // allowed, but there is no such upload
    expect((await supervisor.del(`/api/records/entries/${rec.id}`)).status).toBe(200);
  });

  it('U6: approve — a move for approvers is made by approvers only; admins may do everything', async () => {
    const { typeId, rec, member, supervisor, hod, admin, ea } = await guarded();
    const move = (api: Client, action: string, note?: string) =>
      api.post(`/api/records/entries/${rec.id}/move`, { action, note });
    // "Mark visited" is for editors (and the creator): not a member, not the HOD, not someone who can't see it.
    for (const api of [member, hod, ea]) expect((await move(api, 'visit')).status).toBe(403);
    expect((await move(supervisor, 'visit')).status).toBe(200);
    // "Approve" is for approvers: the supervisor who edits can't.
    for (const api of [member, supervisor, ea]) expect((await move(api, 'approve')).status).toBe(403);
    expect((await move(hod, 'send_back', 'Add photos')).status).toBe(200);
    // An admin (records.admin) may make any move and do everything else.
    expect((await move(admin, 'visit')).status).toBe(200);
    expect((await move(admin, 'approve')).body.status).toBe('approved');
    expect((await admin.del(`/api/records/entries/${rec.id}`)).status).toBe(200);
    expect(
      (await admin.post(`/api/records/types/${typeId}/records`, { data: { site: 'By admin' } })).status,
    ).toBe(200);
  });

  it('U6: setting types up needs records.admin; rights also come from the Roles matrix; roles must be real', async () => {
    const { typeId, w, member, supervisor, hod, ea, admin } = await guarded();
    for (const api of [member, supervisor, hod, ea]) {
      expect(
        (await api.post('/api/records/types', siteVisit({ name: 'Trip', pluralName: 'Trips', prefix: 'TR' })))
          .status,
      ).toBe(403);
      expect((await api.patch(`/api/records/types/${typeId}`, { name: 'Mine' })).status).toBe(403);
      expect((await api.post(`/api/records/types/${typeId}/archive`)).status).toBe(403);
      expect((await api.post(`/api/records/types/${typeId}/restore`)).status).toBe(403);
      expect((await api.del(`/api/records/types/${typeId}`)).status).toBe(403);
    }
    expect((await admin.patch(`/api/records/types/${typeId}`, { description: 'By the admin' })).status).toBe(
      200,
    );
    // Built-in defaults: only Owner and Admin hold records.* — everyone else is decided per type.
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).toContain('records.admin');
    for (const key of ['HOD', 'SUPERVISOR', 'EA', 'MEMBER'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[key].filter((p) => p.startsWith('records.'))).toEqual([]);
    // A role given "records.view" in the Roles matrix sees every type, without being named on it.
    const auditor = (
      await w.api.post('/api/org/roles', { name: 'Auditor', permissions: ['records.view', 'org.view'] })
    ).body;
    const viewer = (await w.person('Asha Auditor', auditor.id)).api;
    expect((await ea.get(`/api/records/types/${typeId}/records`)).status).toBe(403);
    expect((await viewer.get(`/api/records/types/${typeId}/records`)).status).toBe(200);
    expect((await viewer.post(`/api/records/types/${typeId}/records`, { data: { site: 'X' } })).status).toBe(
      403,
    );
    const roleless = siteVisit({
      permissions: { view: ['no-such-role'], create: [], edit: [], approve: [] },
    });
    expect(
      (await w.api.post('/api/records/types', { ...roleless, name: 'Ghost', prefix: 'GH' })).status,
    ).toBe(400);
    const def = siteVisit().definition;
    const ghostMove = await w.api.patch(`/api/records/types/${typeId}`, {
      definition: {
        ...def,
        moves: [...def.moves.slice(0, 3), { ...def.moves[3]!, who: ['role:nosuchrole00'] }],
      },
    });
    expect(ghostMove.status).toBe(400);
    expect(ghostMove.body.error.message).toBe('A role chosen here does not exist any more: pick again');
    // A move for one named role: its people may make it, even without the edit right.
    const named = await w.api.patch(`/api/records/types/${typeId}`, {
      definition: {
        ...def,
        moves: [...def.moves.slice(0, 3), { ...def.moves[3]!, who: [`role:${w.role('MEMBER')}`] }],
      },
    });
    expect(named.status).toBe(200);
    const rec = await makeRecord(w.api, typeId, { site: 'For the member' });
    expect(
      (await supervisor.post(`/api/records/entries/${rec.id}/move`, { action: 'cancel', note: 'x' })).status,
    ).toBe(403);
    expect(
      (await member.post(`/api/records/entries/${rec.id}/move`, { action: 'cancel', note: 'Not needed' }))
        .body.status,
    ).toBe('cancelled');
  });

  it('U6: company scoping — another company never sees or touches a type, its records, views or files', async () => {
    const { typeId, rec, w } = await guarded();
    const view = (await w.api.post(`/api/records/types/${typeId}/views`, { name: 'Mine', config: {} })).body;
    const other = await world(ctx.app);
    const theirs = await makeType(other.api);
    const o = other.api;
    const calls: [string, Promise<{ status: number }>][] = [
      ['type', o.get(`/api/records/types/${typeId}`)],
      ['patch type', o.patch(`/api/records/types/${typeId}`, { name: 'Stolen' })],
      ['archive', o.post(`/api/records/types/${typeId}/archive`)],
      ['delete type', o.del(`/api/records/types/${typeId}`)],
      ['list', o.get(`/api/records/types/${typeId}/records`)],
      ['export', o.get(`/api/records/types/${typeId}/export`)],
      ['import', o.post(`/api/records/types/${typeId}/import`, { table: [['Site'], ['X']] })],
      ['create', o.post(`/api/records/types/${typeId}/records`, { data: { site: 'X' } })],
      ['views', o.get(`/api/records/types/${typeId}/views`)],
      ['save view', o.put(`/api/records/types/${typeId}/views/${view.id}`, { name: 'x', config: {} })],
      [
        'their type, our view',
        o.put(`/api/records/types/${theirs}/views/${view.id}`, { name: 'x', config: {} }),
      ],
      ['delete view', o.del(`/api/records/types/${theirs}/views/${view.id}`)],
      ['record', o.get(`/api/records/entries/${rec.id}`)],
      ['change', o.patch(`/api/records/entries/${rec.id}`, { data: { site: 'X' } })],
      ['move', o.post(`/api/records/entries/${rec.id}/move`, { action: 'visit' })],
      ['note', o.post(`/api/records/entries/${rec.id}/notes`, { note: 'x' })],
      ['files', o.post(`/api/records/entries/${rec.id}/files`, { ids: ['x'] })],
      ['delete', o.del(`/api/records/entries/${rec.id}`)],
      ['pick', o.get(`/api/masters/options?source=rt:${typeId}`)],
    ];
    for (const [what, call] of calls) expect([what, (await call).status]).toEqual([what, 404]);
    expect(((await o.get('/api/records/types')).body.types as { id: string }[]).map((t) => t.id)).toEqual([
      theirs,
    ]);
    expect(((await o.get('/api/records/menu')).body as { id: string }[]).map((t) => t.id)).toEqual([theirs]);
    // Two companies each have their own SV series and their own "site_visit" code.
    const mine = await makeRecord(other.api, theirs, { site: 'Their site' });
    expect(mine.code).toBe(rec.code);
    expect((await other.api.get(`/api/records/types/${theirs}/records`)).body.total).toBe(1);
    expect((await w.api.get(`/api/records/entries/${rec.id}`)).body.record.title).toBe('Tonk mine');
  });
});
