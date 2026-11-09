import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe('Org chart → open work', () => {
  it('lists a person’s open work, late first, to admins and to themselves only', async () => {
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
    const sandeep = await make('Sandeep Pal');
    const ajay = await make('Ajay Kumar');
    await o.api.post('/api/tasks', {
      doerId: sandeep.id,
      plannedAt: inHours(5),
      description: 'Send price list',
    });
    await o.api.post('/api/tasks', {
      doerId: sandeep.id,
      plannedAt: inHours(-2),
      description: 'Calibrate press',
    });

    const seen = (await o.api.get(`/api/work/people/${sandeep.id}/open`)).body;
    expect(seen).toMatchObject({ total: 2, late: 1, counts: { task: 2, checklist: 0, fms: 0, ticket: 0 } });
    expect(
      seen.items.map((i: { title: string; late: boolean }) => [
        i.title.split(' ').slice(1).join(' '),
        i.late,
      ]),
    ).toEqual([
      ['Calibrate press', true],
      ['Send price list', false],
    ]);
    expect(seen.items[0].link).toMatch(/^\/delegation\?task=/);

    expect((await sandeep.api.get(`/api/work/people/${sandeep.id}/open`)).body.total).toBe(2);
    expect((await ajay.api.get(`/api/work/people/${sandeep.id}/open`)).status).toBe(403);
    expect((await o.api.get('/api/work/people/nobody/open')).status).toBe(404);
  });
});
