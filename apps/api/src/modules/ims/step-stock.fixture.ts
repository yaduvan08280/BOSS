import type { makeApp, signedIn } from '../../test/helpers';
import { ownerClient, signedIn as signIn } from '../../test/helpers';

/** Shared by the stock-on-steps tests (phase 11, package D). */
type Ctx = Awaited<ReturnType<typeof makeApp>>;
const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
export const time = { value: 2, unit: 'hours', anchor: 'previous' };
export type Api = Awaited<ReturnType<typeof signedIn>>;
export type Step = { id: string; stepKey: string; status: string };

/** A company with a doer, a manager, a store keeper who approves stock, and two items in stock. */
export async function plant(ctx: Ctx) {
  const o = await ownerClient(ctx.app);
  const make = async (name: string) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
    const api = await signIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: 'Secret12345',
    });
    return { id: r.person.id as string, api };
  };
  const doer = await make('Ravi Doer');
  const boss = await make('Arvind Boss');
  const keeper = await make('Gopal Keeper');
  await o.api.put('/api/ims/rules', { people: { approverIds: [keeper.id], storeKeeperIds: [keeper.id] } });
  const item = async (code: string, name: string, unit: string, openingQty: number) =>
    (await o.api.post('/api/ims/items', { code, name, unit, ratePaise: 25_000, openingQty })).body as {
      id: string;
    };
  const bearing = await item('SP-6205', 'Bearing 6205', 'pcs', 24);
  const resin = await item('RM-002', 'Polyester resin', 'kg', 400);
  const stock = async (id: string) =>
    Number((await ctx.prisma.item.findUniqueOrThrow({ where: { id } })).stock);
  /** Build and publish a flow; returns its id. */
  const flow = async (name: string, definition: object) => {
    const f = (await o.api.post('/api/fms/flows', { meta: { name, runName: 'Job' } })).body;
    await o.api.put(`/api/fms/flows/${f.id}`, {
      definition: { timeModel: 'calendar', ...definition },
      meta: { coordinatorId: boss.id, solverId: boss.id },
    });
    const pub = await o.api.post(`/api/fms/flows/${f.id}/publish`);
    if (pub.status !== 200) throw new Error(JSON.stringify(pub.body));
    return f.id as string;
  };
  const start = (flowId: string, data: object, who: Api = doer.api) =>
    who.post(`/api/fms/flows/${flowId}/records`, { data });
  const record = async (id: string) => (await o.api.get(`/api/fms/records/${id}`)).body;
  const open = async (id: string): Promise<Step> =>
    (await record(id)).steps.find((s: Step) => s.status === 'OPEN');
  const done = (who: Api, step: Step, body: object = {}) =>
    who.post(`/api/fms/steps/${step.id}/complete`, body);
  /** A record's moves, oldest first; the lines of one step (one transaction, one time) by their quantity. */
  const moves = async (recordId: string) =>
    (await ctx.prisma.stockMove.findMany({ where: { refType: 'fms_record', refId: recordId } })).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || Number(a.lineQty) - Number(b.lineQty),
    );
  return {
    ...o,
    companyId: o.company.id,
    doer,
    boss,
    keeper,
    bearing,
    resin,
    stock,
    flow,
    start,
    record,
    open,
    done,
    moves,
  };
}

export const itemsField = (extra: object = {}) => ({ key: 'lines', label: 'Items', type: 'items', ...extra });
export const task = (key: string, doerId: string, extra: object = {}) => ({
  ...{ key, name: key, type: 'TASK', doerIds: [doerId], time },
  ...extra,
});
