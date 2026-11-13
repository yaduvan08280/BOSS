#!/usr/bin/env node
// MONO service-peak load test (plan §11): POS devices taking, firing, billing and paying orders while front-desk
// and back-office people read their screens — all at once, each signed in as a different person.
//
//   BASE=http://localhost:8080 LOGIN=9000000000 PASSWORD=Demo1234 node deploy/loadtest/service-peak.mjs
//
// Settings (env): POS (30 devices), DESK (10), OFFICE (50), SECONDS (180), THINK_MS (pause between a device's
// steps, 1500), P95_MS (the gate for POS actions, 300). It makes its own outlet, tables, menu, room and people
// (named "Load …") in the company it signs in to — run it on a test company, never on live data.
// Exit code 1 when the gate fails or more than 1 % of requests fail.
const env = process.env;
const BASE = (env.BASE ?? 'http://localhost:8080').replace(/\/$/, '');
const ORIGIN = env.ORIGIN ?? BASE;
const N = { pos: Number(env.POS ?? 30), desk: Number(env.DESK ?? 10), office: Number(env.OFFICE ?? 50) };
const SECONDS = Number(env.SECONDS ?? 180);
const THINK = Number(env.THINK_MS ?? 1500);
const GATE = Number(env.P95_MS ?? 300);
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const samples = new Map();
const failures = new Map();
let stop = false;

/** One signed-in person: keeps their own cookies. */
function person() {
  let cookie = '';
  const call = async (kind, method, path, body) => {
    const started = performance.now();
    let status = 0;
    let json = null;
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          ...(cookie ? { cookie } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      status = res.status;
      const set = res.headers.getSetCookie?.() ?? [];
      if (set.length) {
        const jar = new Map(
          cookie
            .split('; ')
            .filter(Boolean)
            .map((c) => [c.split('=')[0], c]),
        );
        for (const c of set) jar.set(c.split('=')[0], c.split(';')[0]);
        cookie = [...jar.values()].join('; ');
      }
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      // The server could not be reached: counted as a failure (status 0).
    }
    if (kind) {
      const list = samples.get(kind) ?? [];
      list.push(performance.now() - started);
      samples.set(kind, list);
      if (status < 200 || status >= 300)
        failures.set(`${kind} ${status}`, (failures.get(`${kind} ${status}`) ?? 0) + 1);
    }
    return { status, json };
  };
  return {
    call,
    get: (kind, path) => call(kind, 'GET', path),
    post: (kind, path, body = {}) => call(kind, 'POST', path, body),
    put: (kind, path, body = {}) => call(kind, 'PUT', path, body),
  };
}
const must = (r, what) => {
  if (r.status < 200 || r.status >= 300)
    throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

const owner = person();
must(
  await owner.post(null, '/api/auth/login', {
    identifier: env.LOGIN ?? '9000000000',
    password: env.PASSWORD ?? 'Demo1234',
  }),
  'Sign-in',
);
must(await owner.put(null, '/api/hosp/settings', { enabled: true }), 'Hospitality');
const branches = must(await owner.get(null, '/api/org/branches'), 'Branches');
const branch = (Array.isArray(branches) ? branches : branches.branches)[0];
const roles = must(await owner.get(null, '/api/org/roles'), 'Roles').roles;
// Admins: the test measures speed, not rights (those have their own tests).
const hod = roles.find((r) => r.key === 'ADMIN').id;
const outlet = must(
  await owner.post(null, '/api/hosp/outlets', { name: `Load ${tag}`, branchId: branch.id }),
  'Outlet',
);
must(await owner.post(null, '/api/hosp/stations', { outletId: outlet.id, name: 'Kitchen' }), 'Station');
const floor = must(
  await owner.post(null, '/api/hosp/floors', { outletId: outlet.id, name: 'Hall' }),
  'Floor',
);
must(await owner.post(null, '/api/hosp/tables/bulk', { floorId: floor.id, count: N.pos }), 'Tables');
const plan = must(await owner.get(null, `/api/hosp/outlets/${outlet.id}/plan`), 'Floor plan');
const tables = (plan.floors ?? plan).flatMap((f) => f.tables ?? []).map((t) => t.id);
const cat = must(
  await owner.post(null, '/api/hosp/menu/categories', { name: `Load food ${tag}` }),
  'Category',
);
const dishes = [];
for (const [name, price] of [
  ['Dal', 28000],
  ['Naan', 6000],
  ['Paneer', 32000],
])
  dishes.push(
    must(
      await owner.post(null, '/api/hosp/menu/items', {
        categoryId: cat.id,
        outletIds: [outlet.id],
        name: `${name} ${tag}`,
        price,
      }),
      'Menu item',
    ).id,
  );
const cash = must(
  await owner.post(null, '/api/money/modes', { name: `Load cash ${tag}`, kind: 'CASH' }),
  'Cash mode',
);

/** A new person with their own sign-in. */
let seq = 0;
async function signedIn(name) {
  const mobile = `7${String(Date.now()).slice(-6)}${String(++seq).padStart(3, '0')}`;
  const made = must(
    await owner.post(null, '/api/org/users', {
      name: `Load ${name} ${tag}`,
      mobile,
      loginEnabled: true,
      roleId: hod,
    }),
    'Person',
  );
  const p = person();
  must(
    await p.post(null, '/api/auth/login', { identifier: mobile, password: made.tempPassword }),
    'Person sign-in',
  );
  must(
    await p.post(null, '/api/auth/change-password', {
      currentPassword: made.tempPassword,
      newPassword: 'LoadTest12345',
    }),
    'Password',
  );
  return p;
}
console.log(`Setting up ${N.pos} POS devices, ${N.desk} front-desk and ${N.office} back-office people…`);
const pos = [];
for (let i = 0; i < N.pos; i++) pos.push(await signedIn(`steward ${i + 1}`));
const desk = [];
for (let i = 0; i < N.desk; i++) desk.push(await signedIn(`desk ${i + 1}`));
const office = [];
for (let i = 0; i < N.office; i++) office.push(await signedIn(`office ${i + 1}`));

let orders = 0;
let kots = 0;
async function device(p, tableId) {
  await sleep(Math.random() * THINK);
  while (!stop) {
    const o = await p.post('pos:open', '/api/pos/orders', {
      outletId: outlet.id,
      tableIds: [tableId],
      covers: 2,
    });
    if (o.status !== 200) {
      await sleep(THINK);
      continue;
    }
    await sleep(THINK);
    const added = await p.post('pos:fire', `/api/pos/orders/${o.json.id}/items`, {
      items: [
        { menuItemId: dishes[0], qty: 1 },
        { menuItemId: dishes[1 + (orders % 2)], qty: 2 },
      ],
      fire: true,
    });
    if (added.status === 200) kots += added.json.kots?.length ?? 0;
    await sleep(THINK);
    await p.get('pos:read', `/api/pos/orders/${o.json.id}`);
    await sleep(THINK);
    const c = await p.post('pos:bill', `/api/pos/orders/${o.json.id}/check`, {});
    await sleep(THINK);
    if (c.status === 200)
      await p.post('pos:pay', `/api/pos/checks/${c.json.id}/pay`, {
        payments: [{ modeId: cash.id, amount: c.json.total }],
      });
    orders++;
    await sleep(THINK);
  }
}
async function reader(p, kind, paths) {
  await sleep(Math.random() * 2000);
  while (!stop) {
    for (const path of paths) {
      if (stop) break;
      await p.get(kind, path);
      await sleep(1000 + Math.random() * 2000);
    }
  }
}
const started = Date.now();
console.log(`Running for ${SECONDS} s against ${BASE} …`);
setTimeout(() => (stop = true), SECONDS * 1000);
await Promise.all([
  ...pos.map((p, i) => device(p, tables[i % tables.length])),
  ...desk.map((p) =>
    reader(p, 'desk', [
      `/api/hotel/desk?branchId=${branch.id}`,
      `/api/hotel/tape?branchId=${branch.id}&days=14`,
      `/api/reservations/outlets/${outlet.id}/book`,
    ]),
  ),
  ...office.map((p) =>
    reader(p, 'office', [
      '/api/auth/me',
      '/api/work/counts',
      '/api/tasks',
      '/api/notifications',
      '/api/checklists/runs',
    ]),
  ),
]);
const minutes = (Date.now() - started) / 60_000;
const q = (list, p) =>
  list.sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))] ?? 0;
const rows = [...samples].sort().map(([kind, list]) => ({
  action: kind,
  requests: list.length,
  p50: Math.round(q(list, 0.5)),
  p95: Math.round(q(list, 0.95)),
  max: Math.round(Math.max(...list)),
}));
console.table(rows);
const total = rows.reduce((n, r) => n + r.requests, 0);
const failed = [...failures.values()].reduce((n, v) => n + v, 0);
const posP95 = Math.max(...rows.filter((r) => r.action.startsWith('pos:')).map((r) => r.p95));
console.log(
  JSON.stringify({
    minutes: Math.round(minutes * 10) / 10,
    people: N,
    orders,
    kots,
    kotsPerHour: Math.round((kots / minutes) * 60),
    requests: total,
    requestsPerSecond: Math.round(total / (minutes * 60)),
    failed,
    failures: Object.fromEntries(failures),
    posP95Ms: posP95,
    gateMs: GATE,
    pass: posP95 <= GATE && failed <= total * 0.01,
  }),
);
process.exit(posP95 <= GATE && failed <= total * 0.01 ? 0 : 1);
