import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { publish, task } from '../forms/test-kit';
import { makeRecord, makeType, siteVisit, world } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type World = Awaited<ReturnType<typeof world>>;

/** A site-visit type whose "Confirm" move starts a published "Visit follow-up" process. */
async function setUp(w: World, map?: Record<string, string>) {
  const base = siteVisit();
  // Made first (without the start), so the process's start form can pick one of its records.
  const typeId = await makeType(w.api, base);
  const flowId = await publish(w.api, 'Visit follow-up', {
    startFields: [
      { key: 'visit', label: 'Visit', type: 'master', master: `rt:${typeId}`, required: true },
      { key: 'place', label: 'Place', type: 'text', required: true },
      { key: 'ref_no', label: 'Reference', type: 'text' },
      { key: 'budget', label: 'Budget', type: 'amount' },
      { key: 'why', label: 'Why', type: 'text' },
    ],
    steps: [task('call', w.owner.id)],
  });
  const withStart = (m: Record<string, string>) => ({
    ...base.definition,
    moves: base.definition.moves.map((x) =>
      x.action === 'visit' ? { ...x, startFlow: { flowId, map: m } } : x,
    ),
  });
  const definition = withStart(
    map ?? {
      visit: 'record',
      place: 'field:site',
      ref_no: 'code',
      budget: 'field:cost',
      why: 'text:From a visit',
    },
  );
  const saved = await w.api.patch(`/api/records/types/${typeId}`, { definition });
  return { typeId, flowId, saved, withStart };
}

describe('record types reach the rest of MONO', () => {
  it('U7: a move starts a process with the mapped values, and the two records point at each other', async () => {
    const w = await world(ctx.app);
    const { typeId, flowId, saved } = await setUp(w);
    expect(saved.status).toBe(200);
    // The editor's list of processes a move may start, with their start fields.
    const offered = await w.api.get('/api/records/flows');
    expect(offered.body).toEqual([
      expect.objectContaining({
        id: flowId,
        name: 'Visit follow-up',
        startFields: expect.arrayContaining([
          { key: 'visit', label: 'Visit', type: 'master', required: true, master: `rt:${typeId}` },
        ]),
      }),
    ]);
    const member = await w.person('Gopal Prajapat');
    expect((await member.api.get('/api/records/flows')).status).toBe(403);

    const visit = await makeRecord(w.api, typeId, { site: 'Tonk mine', cost: '1500.50' });
    const moved = await w.api.post(`/api/records/entries/${visit.id}/move`, { action: 'visit' });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('visited');

    const started = await ctx.prisma.fmsRecord.findMany({ where: { companyId: w.companyId, flowId } });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ startedById: w.owner.id, source: 'record', status: 'RUNNING' });
    expect(started[0]!.data).toEqual({
      visit: `${visit.code} · Tonk mine`,
      place: 'Tonk mine',
      ref_no: visit.code,
      budget: 1500.5,
      why: 'From a visit',
      _refs: { visit: `rt:${visit.id}` },
    });
    // The first step is open for its doer, like any record started from the start form.
    expect(
      await ctx.prisma.fmsRecordStep.count({ where: { recordId: started[0]!.id, status: 'OPEN' } }),
    ).toBe(1);
    // Both histories say it.
    const detail = (await w.api.get(`/api/records/entries/${visit.id}`)).body;
    const line = detail.events.find((e: { type: string }) => e.type === 'flow_started');
    expect(line).toMatchObject({
      note: null, // a history line, not something a person wrote
      data: { flowId, flow: 'Visit follow-up', fmsRecordId: started[0]!.id, number: started[0]!.number },
    });
    const fmsNote = await ctx.prisma.fmsRecordEvent.findFirst({
      where: { recordId: started[0]!.id, type: 'note' },
    });
    expect(fmsNote?.note).toBe(`Started from Site visit ${visit.code}`);
    // A move without the setting starts nothing.
    await w.api.post(`/api/records/entries/${visit.id}/move`, { action: 'approve' });
    expect(await ctx.prisma.fmsRecord.count({ where: { companyId: w.companyId, flowId } })).toBe(1);
  });

  it('U7: when the process can not start, the move is refused and nothing is written', async () => {
    const w = await world(ctx.app);
    // "Place" comes from a field the visit may leave empty.
    const { typeId, flowId } = await setUp(w, { visit: 'record', place: 'field:kind' });
    const visit = await makeRecord(w.api, typeId, { site: 'Niwai factory' });
    const refused = await w.api.post(`/api/records/entries/${visit.id}/move`, { action: 'visit' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toBe('"Visit follow-up" can\'t start: Place is required');
    expect((await w.api.get(`/api/records/entries/${visit.id}`)).body.record.status).toBe('planned');
    expect(await ctx.prisma.fmsRecord.count({ where: { companyId: w.companyId, flowId } })).toBe(0);
    expect(
      await ctx.prisma.domainEvent.count({
        where: { companyId: w.companyId, entityId: visit.id, name: 'record.status_changed' },
      }),
    ).toBe(0);
    // With the field filled the same move goes through.
    await w.api.patch(`/api/records/entries/${visit.id}`, {
      data: { site: 'Niwai factory', kind: 'Survey' },
    });
    expect((await w.api.post(`/api/records/entries/${visit.id}/move`, { action: 'visit' })).status).toBe(200);
    expect(await ctx.prisma.fmsRecord.count({ where: { companyId: w.companyId, flowId } })).toBe(1);

    // The process is archived later: the move says so instead of failing in the dark.
    const second = await makeRecord(w.api, typeId, { site: 'Kishangarh plant', kind: 'Repair' });
    await ctx.prisma.flow.update({ where: { id: flowId }, data: { status: 'ARCHIVED' } });
    const gone = await w.api.post(`/api/records/entries/${second.id}/move`, { action: 'visit' });
    expect(gone.status).toBe(409);
    expect(gone.body.error.message).toContain('"Visit follow-up", which is not published');
  });

  it('U7: the setting is checked when the type is saved', async () => {
    const w = await world(ctx.app);
    const { typeId, flowId, withStart } = await setUp(w);
    const save = (map: Record<string, string>, flow = flowId) => {
      const def = withStart(map);
      const moves = def.moves.map((m) => ('startFlow' in m ? { ...m, startFlow: { flowId: flow, map } } : m));
      return w.api.patch(`/api/records/types/${typeId}`, { definition: { ...def, moves } });
    };
    const message = async (r: Promise<{ status: number; body: { error: { message: string } } }>) => {
      const res = await r;
      expect(res.status).toBe(400);
      return res.body.error.message;
    };
    // A required start field with no source; a start field that is not there; a field of the record that is not there.
    expect(await message(save({ visit: 'record' }))).toBe(
      'The move "Mark visited": "Visit follow-up" needs "Place" to start — say where it comes from',
    );
    expect(await message(save({ visit: 'record', place: 'title', nope: 'code' }))).toContain(
      'has no start field "nope"',
    );
    expect(await message(save({ visit: 'record', place: 'field:ghost' }))).toContain(
      'starts a process with a field that does not exist any more',
    );
    // A process of another company, or a draft, can't be chosen.
    const other = await world(ctx.app);
    const theirs = await publish(other.api, 'Their process', {
      startFields: [{ key: 'place', label: 'Place', type: 'text' }],
      steps: [task('call', other.owner.id)],
    });
    expect(await message(save({ place: 'title' }, theirs))).toContain('does not exist any more');
    const draft = (await w.api.post('/api/fms/flows', { meta: { name: 'Draft only', runName: 'Run' } })).body;
    expect(await message(save({ place: 'title' }, draft.id))).toContain('"Draft only" is not published yet');
  });
});
