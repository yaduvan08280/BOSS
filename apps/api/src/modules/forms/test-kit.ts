import { makeCompany, ownerClient, signedIn, type makeApp } from '../../test/helpers';

export type Ctx = Awaited<ReturnType<typeof makeApp>>;
export type Api = Awaited<ReturnType<typeof signedIn>>;

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;

/** A company with its owner and one more person (a Member unless a role is given), both signed in. */
export async function team(ctx: Ctx, roleId?: string) {
  const o = await ownerClient(ctx.app);
  const person = async (name: string, role?: string) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true, roleId: role })).body;
    const api = await signedIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: 'Secret12345',
    });
    return { id: r.person.id as string, api };
  };
  return { ...o, person, member: await person('Neha Sales', roleId) };
}

/** Another company's owner, signed in. */
export async function stranger(ctx: Ctx) {
  const c = await makeCompany(ctx.app);
  return { api: await signedIn(ctx.app, c.mobile, c.password), ownerId: c.owner.id };
}

const time = { value: 4, unit: 'hours', anchor: 'previous' };
export const task = (key: string, doerId: string, fields: object[] = []) => ({
  key,
  name: key,
  type: 'TASK',
  doerIds: [doerId],
  time,
  fields,
});

/** Create a flow, save its definition and publish it. Returns the flow's id. */
export async function publish(
  api: Api,
  name: string,
  definition: { startFields: object[]; steps: object[] },
) {
  const flow = (await api.post('/api/fms/flows', { meta: { name, runName: 'Record' } })).body;
  const saved = await api.put(`/api/fms/flows/${flow.id}`, {
    definition: { timeModel: 'calendar', ...definition },
  });
  if (saved.status !== 200) throw new Error(`save failed: ${JSON.stringify(saved.body)}`);
  const done = await api.post(`/api/fms/flows/${flow.id}/publish`);
  if (done.status !== 200) throw new Error(`publish failed: ${JSON.stringify(done.body)}`);
  return flow.id as string;
}

/** Publish the same flow again with a changed definition. */
export async function republish(
  api: Api,
  flowId: string,
  definition: { startFields: object[]; steps: object[] },
) {
  await api.put(`/api/fms/flows/${flowId}`, { definition: { timeModel: 'calendar', ...definition } });
  const done = await api.post(`/api/fms/flows/${flowId}/publish`);
  if (done.status !== 200) throw new Error(`publish failed: ${JSON.stringify(done.body)}`);
}

export const start = (api: Api, flowId: string, data: object) =>
  api.post(`/api/fms/flows/${flowId}/records`, { data });

export async function openStep(api: Api, recordId: string) {
  const r = (await api.get(`/api/fms/records/${recordId}`)).body;
  return r.steps.find((s: { status: string }) => s.status === 'OPEN') as { id: string; stepKey: string };
}

/** Finish the record's open step with these values. */
export async function doStep(api: Api, recordId: string, data: object = {}) {
  const step = await openStep(api, recordId);
  return api.post(`/api/fms/steps/${step.id}/complete`, { data });
}

export const cancel = (api: Api, recordId: string) =>
  api.post(`/api/fms/records/${recordId}/actions`, { action: 'cancel', reason: 'test' });

type Opt = {
  value: string;
  label: string;
  sub: string | null;
  ref?: string;
  columns?: Record<string, unknown>;
};
/** The options route. */
export async function options(api: Api, params: Record<string, string>) {
  const r = await api.get(`/api/masters/options?${new URLSearchParams(params).toString()}`);
  return { status: r.status, list: (Array.isArray(r.body) ? r.body : []) as Opt[] };
}

/** A master with these fields; returns its id. */
export async function master(api: Api, name: string, fields: object[], displayField = 'name') {
  const r = await api.post('/api/masters', { name, fields, displayField });
  if (r.status !== 200) throw new Error(`master failed: ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}

export const row = async (api: Api, masterId: string, data: object) =>
  (await api.post(`/api/masters/${masterId}/rows`, data)).body as { id: string; label: string };
