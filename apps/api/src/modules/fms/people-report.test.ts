import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const ago = (min: number) => new Date(Date.now() - min * 60_000);

async function team() {
  const o = await ownerClient(ctx.app);
  const make = async (name: string) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
    const api = await signedIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: 'Secret12345',
    });
    return { id: r.person.id as string, api };
  };
  return { ...o, neha: await make('Neha Sales'), anil: await make('Anil Store') };
}

describe('Delegation → FMS report', () => {
  it('grades each person’s steps for the week and shows people only what they may see', async () => {
    const { api, neha, anil } = await team();
    const flow = (await api.post('/api/fms/flows', { meta: { name: 'Order to dispatch', runName: 'Order' } }))
      .body;
    const time = { value: 2, unit: 'hours', anchor: 'previous' };
    await api.put(`/api/fms/flows/${flow.id}`, {
      definition: {
        timeModel: 'calendar',
        startFields: [{ key: 'customer', label: 'Customer', type: 'text', required: true }],
        steps: [
          { key: 'confirm', name: 'Confirm order', type: 'TASK', doerIds: [neha.id], time },
          { key: 'dispatch', name: 'Dispatch', type: 'TASK', doerIds: [anil.id], time },
        ],
      },
      meta: { coordinatorId: anil.id, solverId: anil.id },
    });
    expect((await api.post(`/api/fms/flows/${flow.id}/publish`)).status).toBe(200);

    const start = async (customer: string) => {
      const rec = (await neha.api.post(`/api/fms/flows/${flow.id}/records`, { data: { customer } })).body;
      return ctx.prisma.fmsRecordStep.findFirstOrThrow({ where: { recordId: rec.id, status: 'OPEN' } });
    };
    // Done on time, still open and late, and late but its record is on hold (doesn't count).
    const onTime = await start('Sharma');
    await ctx.prisma.fmsRecordStep.update({
      where: { id: onTime.id },
      data: { status: 'DONE', plannedAt: ago(0), doneAt: ago(1) },
    });
    const late = await start('Verma');
    await ctx.prisma.fmsRecordStep.update({ where: { id: late.id }, data: { plannedAt: ago(1) } });
    const held = await start('Gupta');
    await ctx.prisma.fmsRecordStep.update({ where: { id: held.id }, data: { plannedAt: ago(1) } });
    await ctx.prisma.fmsRecord.update({ where: { id: held.recordId }, data: { status: 'ON_HOLD' } });

    const all = (await api.get('/api/fms/reports/people')).body;
    expect(all.rows).toEqual([
      expect.objectContaining({ name: 'Neha Sales', due: 2, done: 1, onTime: 1, late: 1, onTimePct: 50 }),
    ]);
    expect(all.flows).toEqual([
      expect.objectContaining({ name: 'Order to dispatch', late: 1, onTimePct: 50 }),
    ]);
    expect(all.total).toMatchObject({ done: 1, late: 1 });

    // A member sees only their own steps; someone with none sees an empty week.
    expect(
      (await neha.api.get('/api/fms/reports/people')).body.rows.map((r: { name: string }) => r.name),
    ).toEqual(['Neha Sales']);
    expect((await anil.api.get('/api/fms/reports/people')).body).toMatchObject({ rows: [], flows: [] });

    // The Weekly MIS grades the same steps, and they count towards the score.
    const mis = (await api.get('/api/mis')).body.rows;
    const nehaMis = mis.find((r: { name: string }) => r.name === 'Neha Sales');
    expect(nehaMis.fms).toEqual({ total: 2, good: 1, pct: 50 });
    expect(nehaMis.score).toBe(50);
    expect(mis.find((r: { name: string }) => r.name === 'Anil Store').fms.pct).toBeNull();
  });
});
