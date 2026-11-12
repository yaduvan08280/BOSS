import { financialYear } from '@mono/shared';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

type App = Awaited<ReturnType<typeof makeApp>>['app'];
export type Client = Awaited<ReturnType<typeof signedIn>>;

let n = 0;
const mobile = () => `8${String(Date.now()).slice(-6)}${String((n += 1) % 1000).padStart(3, '0')}`;

/** A fresh company with its owner signed in, the built-in role ids, and a way to add signed-in people. */
export async function world(app: App) {
  const o = await ownerClient(app);
  const roles = (await o.api.get('/api/org/roles')).body.roles as { id: string; key: string | null }[];
  const role = (key: string) => roles.find((r) => r.key === key)!.id;
  /** `roleKey`: a built-in role (MEMBER, HOD …) or the id of a custom role. */
  const person = async (name: string, roleKey = 'MEMBER') => {
    const m = mobile();
    const roleId = roles.find((x) => x.key === roleKey)?.id ?? roleKey;
    const r = (await o.api.post('/api/org/users', { name, mobile: m, loginEnabled: true, roleId })).body;
    const api = await signedIn(app, m, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: 'Record12345',
    });
    return { api, id: r.person.id as string };
  };
  return { ...o, role, person, companyId: o.company.id };
}

/** The financial year the test runs in ("26-27"). */
export const FY = financialYear(new Date()).short;

/** A site visit: planned → visited → approved, or cancelled. Editors mark visited; approvers approve. */
export const siteVisit = (over: Record<string, unknown> = {}) => ({
  name: 'Site visit',
  pluralName: 'Site visits',
  prefix: 'SV',
  description: 'A visit to a customer site',
  definition: {
    fields: [
      { key: 'site', label: 'Site', type: 'text', required: true },
      { key: 'visit_on', label: 'Visit on', type: 'date' },
      { key: 'cost', label: 'Cost', type: 'amount' },
      { key: 'kind', label: 'Kind', type: 'dropdown', options: ['Survey', 'Repair'] },
      { key: 'urgent', label: 'Urgent', type: 'yesno' },
    ],
    tables: [],
    statuses: [
      { key: 'planned', label: 'Planned', kind: 'info' },
      { key: 'visited', label: 'Visited', kind: 'warn' },
      { key: 'approved', label: 'Approved', kind: 'ok', final: true },
      { key: 'cancelled', label: 'Cancelled', kind: 'neutral', final: true },
    ],
    start: 'planned',
    moves: [
      { from: 'planned', action: 'visit', label: 'Mark visited', to: 'visited', who: ['edit', 'creator'] },
      { from: 'visited', action: 'approve', label: 'Approve', to: 'approved', who: ['approve'] },
      {
        from: 'visited',
        action: 'send_back',
        label: 'Send back',
        to: 'planned',
        who: ['approve'],
        noteRequired: true,
      },
      {
        from: 'planned',
        action: 'cancel',
        label: 'Cancel',
        to: 'cancelled',
        who: ['creator'],
        noteRequired: true,
      },
    ],
  },
  menu: { section: 'systems', icon: 'map-pin' },
  ...over,
});

export async function makeType(api: Client, input: Record<string, unknown> = siteVisit()) {
  const res = await api.post('/api/records/types', input);
  if (res.status !== 200) throw new Error(`type not made: ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export async function makeRecord(
  api: Client,
  typeId: string,
  data: Record<string, unknown>,
  lines?: Record<string, unknown>,
) {
  const res = await api.post(`/api/records/types/${typeId}/records`, { data, ...(lines ? { lines } : {}) });
  if (res.status !== 200) throw new Error(`record not made: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; code: string; title: string; status: string };
}
