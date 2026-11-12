import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Client = Awaited<ReturnType<typeof ownerClient>>['api'];
const enc = encodeURIComponent;
const offer = async (api: Client, key: string, q = '') =>
  (await api.get(`/api/lists/offer?key=${enc(key)}&q=${enc(q)}`)).body as {
    values: { value: string; uses: number }[];
    total: number;
  };

/** A one-step process whose start form has the given fields. */
async function makeFlow(api: Client, doerId: string, name: string, startFields: object[]) {
  const flow = (await api.post('/api/fms/flows', { meta: { name, runName: 'Job' } })).body;
  await api.put(`/api/fms/flows/${flow.id}`, {
    meta: { coordinatorId: doerId, solverId: doerId },
    definition: {
      timeModel: 'calendar',
      startFields,
      steps: [
        {
          key: 'do',
          name: 'Do it',
          type: 'TASK',
          doerIds: [doerId],
          time: { value: 2, unit: 'hours', anchor: 'previous' },
          fields: [],
        },
      ],
    },
  });
  expect((await api.post(`/api/fms/flows/${flow.id}/publish`)).status).toBe(200);
  return flow.id as string;
}

describe('value lists beyond one process', () => {
  it('L3: a master and a process feed and offer the same named list', async () => {
    const s = await ownerClient(ctx.app);
    const master = (
      await s.api.post('/api/masters', {
        name: 'Machines',
        fields: [
          { key: 'code', label: 'Code', type: 'text', required: true },
          { key: 'make', label: 'Make', type: 'text', learn: true, list: 'makes' },
          { key: 'bay', label: 'Bay', type: 'text', learn: true },
        ],
        keyField: 'code',
        displayField: 'code',
      })
    ).body as { id: string };
    const flowId = await makeFlow(s.api, s.owner.id, 'Breakdown', [
      { key: 'machine_make', label: 'Machine make', type: 'text', learn: true, list: 'makes' },
    ]);

    // A master row teaches the shared list and the field's own list (`master:<id>:<field>`)…
    const row = await s.api.post(`/api/masters/${master.id}/rows`, {
      code: 'M-1',
      make: 'Breton',
      bay: 'Bay 2',
    });
    expect(row.status, JSON.stringify(row.body)).toBe(200);
    expect((await offer(s.api, 'list:makes')).values).toEqual([{ value: 'Breton', uses: 1 }]);
    expect((await offer(s.api, `master:${master.id}:bay`)).values).toEqual([{ value: 'Bay 2', uses: 1 }]);
    // …the process offers it at once, and what the process learns the master offers back.
    expect(
      (await s.api.post(`/api/fms/flows/${flowId}/records`, { data: { machine_make: 'breton' } })).status,
    ).toBe(200);
    await s.api.post(`/api/fms/flows/${flowId}/records`, { data: { machine_make: 'Simec' } });
    expect((await offer(s.api, 'list:makes')).values).toEqual([
      { value: 'Breton', uses: 2 },
      { value: 'Simec', uses: 1 },
    ]);

    // Masters → Lists names both forms under the one list.
    const lists = (await s.api.get('/api/lists')).body as {
      key: string;
      usedIn: { kind: string; name: string; field: string }[];
    }[];
    expect(
      lists
        .find((l) => l.key === 'list:makes')!
        .usedIn.map((u) => `${u.kind}:${u.name}:${u.field}`)
        .sort(),
    ).toEqual(['flow:Breakdown:Machine make', 'master:Machines:Make']);
    expect(lists.find((l) => l.key === `master:${master.id}:bay`)).toMatchObject({ name: 'Bay', values: 1 });
  });

  it('L2: the same new value saved by several forms at once is one value, counted every time', async () => {
    const s = await ownerClient(ctx.app);
    const flowId = await makeFlow(s.api, s.owner.id, 'Gate pass', [
      { key: 'transporter', label: 'Transporter', type: 'text', learn: true },
    ]);
    const key = `flow:${flowId}:transporter`;
    const typed = [
      'Om Logistics',
      'om logistics',
      'OM  LOGISTICS',
      ' Om Logistics ',
      'Om Logistics',
      'Om logistics',
    ];
    const saved = await Promise.all(
      typed.map((transporter) => s.api.post(`/api/fms/flows/${flowId}/records`, { data: { transporter } })),
    );
    expect(saved.map((r) => r.status)).toEqual(typed.map(() => 200));
    const got = await offer(s.api, key);
    expect(got.total).toBe(1);
    expect(got.values[0]!.uses).toBe(typed.length);
    expect(await ctx.prisma.valueList.count({ where: { companyId: s.company.id, key } })).toBe(1);
    // One "added" in the audit log, however many forms raced.
    expect(
      await ctx.prisma.auditLog.count({ where: { companyId: s.company.id, action: 'list.value_added' } }),
    ).toBe(1);
  });

  it('L4: a merge keeps a use counted while it runs, and a value of another list is refused', async () => {
    const s = await ownerClient(ctx.app);
    const flowId = await makeFlow(s.api, s.owner.id, 'Dispatch', [
      { key: 'city', label: 'City', type: 'text', learn: true },
      { key: 'state', label: 'State', type: 'text', learn: true },
    ]);
    const start = (data: object) => s.api.post(`/api/fms/flows/${flowId}/records`, { data });
    const first = (await start({ city: 'Kishangarh', state: 'Rajasthan' })).body as { id: string };
    await start({ city: 'Kishangar', state: 'Rajasthan' });
    const values = async (key: string) =>
      (await s.api.get(`/api/lists/values?key=${enc(key)}`)).body.values as { id: string; value: string }[];
    const city = await values(`flow:${flowId}:city`);
    const state = await values(`flow:${flowId}:state`);
    const typo = city.find((v) => v.value === 'Kishangar')!;
    const right = city.find((v) => v.value === 'Kishangarh')!;

    // Another list's value is not a place to merge into.
    expect((await s.api.post(`/api/lists/values/${typo.id}/merge`, { into: state[0]!.id })).status).toBe(400);
    // A form using the typo while the merge runs: its use lands on one side or the other, never lost.
    const [merged, used] = await Promise.all([
      s.api.post(`/api/lists/values/${typo.id}/merge`, { into: right.id }),
      start({ city: 'Kishangar', state: 'Rajasthan' }),
    ]);
    expect(merged.status).toBe(200);
    expect(used.status).toBe(200);
    const after = await offer(s.api, `flow:${flowId}:city`);
    expect(after.values.reduce((n, v) => n + v.uses, 0)).toBe(3);
    expect(after.values[0]).toMatchObject({ value: 'Kishangarh' });
    // The first record still says what it said, and a merged value can't be merged or renamed again.
    const kept = await ctx.prisma.fmsRecord.findUniqueOrThrow({ where: { id: first.id } });
    expect(kept.data).toMatchObject({ city: 'Kishangarh', state: 'Rajasthan' });
    expect((await s.api.patch(`/api/lists/values/${typo.id}`, { value: 'Again' })).status).toBe(404);
    expect((await s.api.post(`/api/lists/values/${typo.id}/merge`, { into: right.id })).status).toBe(404);
  });
});
