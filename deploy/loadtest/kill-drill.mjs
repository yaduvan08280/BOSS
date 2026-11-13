#!/usr/bin/env node
// MONO drill: the server is stopped in the middle of service and started again. Every device keeps the request
// it could not send and sends the SAME request again (same clientId) until the server answers — as the POS
// screen does. Afterwards: every order exists once, every line once, every bill once, no bill number twice.
//
//   BASE=http://localhost:3110 node deploy/loadtest/kill-drill.mjs
//
// While it runs, stop the API (docker compose stop api / kill the process) and start it again. The script
// prints what it saw. Settings (env): DEVICES (10), SECONDS (60), LOGIN, PASSWORD, ORIGIN.
const env = process.env;
const BASE = (env.BASE ?? 'http://localhost:8080').replace(/\/$/, '');
const ORIGIN = env.ORIGIN ?? BASE;
const DEVICES = Number(env.DEVICES ?? 10);
const SECONDS = Number(env.SECONDS ?? 60);
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
let refused = 0;
let down = 0;
/** One call; null when the server could not be reached (or answered 5xx). */
async function once(method, path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { origin: ORIGIN, cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    if (res.status >= 500) return null;
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return null;
  }
}
/** Keep sending the same request until the server answers. */
async function sure(method, path, body) {
  for (;;) {
    const r = await once(method, path, body);
    if (r) return r;
    down++;
    await sleep(500);
  }
}
const ok = (r, what) => {
  if (r.status !== 200) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};
ok(
  await sure('POST', '/api/auth/login', {
    identifier: env.LOGIN ?? '9000000000',
    password: env.PASSWORD ?? 'Demo1234',
  }),
  'Sign-in',
);
ok(await sure('PUT', '/api/hosp/settings', { enabled: true }), 'Hospitality');
const branches = ok(await sure('GET', '/api/org/branches'), 'Branches');
const branch = (Array.isArray(branches) ? branches : branches.branches)[0];
const outlet = ok(
  await sure('POST', '/api/hosp/outlets', { name: `Drill ${tag}`, branchId: branch.id }),
  'Outlet',
);
ok(await sure('POST', '/api/hosp/stations', { outletId: outlet.id, name: 'Kitchen' }), 'Station');
const cat = ok(await sure('POST', '/api/hosp/menu/categories', { name: `Drill food ${tag}` }), 'Category');
const dish = ok(
  await sure('POST', '/api/hosp/menu/items', {
    categoryId: cat.id,
    outletIds: [outlet.id],
    name: `Dal ${tag}`,
    price: 28000,
  }),
  'Dish',
);
const cash = ok(await sure('POST', '/api/money/modes', { name: `Drill cash ${tag}`, kind: 'CASH' }), 'Cash');

/** The outlet's bills of today (each with its order). */
const billsOfOutlet = async () => {
  const r = ok(await sure('GET', `/api/pos/outlets/${outlet.id}/checks`), 'Bills');
  return Array.isArray(r) ? r : (r.checks ?? []);
};
const sent = [];
let stop = false;
async function device(n) {
  for (let i = 0; !stop; i++) {
    const key = `drill-${tag}-${n}-${i}`;
    // A takeaway order: no table, so devices never wait for each other.
    const o = await sure('POST', '/api/pos/orders', {
      outletId: outlet.id,
      type: 'TAKEAWAY',
      tableIds: [],
      clientId: `${key}-order`,
    });
    if (o.status !== 200) {
      refused++;
      continue;
    }
    const lines = await sure('POST', `/api/pos/orders/${o.json.id}/items`, {
      items: [{ menuItemId: dish.id, qty: 1, clientId: `${key}-line` }],
      fire: true,
    });
    if (lines.status !== 200) refused++;
    // The bill has no key of its own: asked twice, the second answer is "already billed" and the bill is read back.
    let c = await sure('POST', `/api/pos/orders/${o.json.id}/check`, {});
    if (c.status === 409)
      c = { status: 200, json: (await billsOfOutlet()).find((x) => x.orderId === o.json.id) };
    if (c.status === 200 && c.json?.id) {
      const paid = await sure('POST', `/api/pos/checks/${c.json.id}/pay`, {
        payments: [{ modeId: cash.id, amount: c.json.total }],
      });
      // Paid twice is refused ("already paid"): that is the right answer to a repeat.
      if (paid.status !== 200 && paid.status !== 409) refused++;
    }
    sent.push({ key, orderId: o.json.id });
    await sleep(300);
  }
}
console.log(
  `Drill running for ${SECONDS} s with ${DEVICES} devices — stop the API now, then start it again.`,
);
setTimeout(() => (stop = true), SECONDS * 1000);
await Promise.all(Array.from({ length: DEVICES }, (_, n) => device(n)));

// What the server holds now.
const ids = new Set(sent.map((s) => s.orderId));
let lines = 0;
let unpaid = 0;
for (const id of ids) {
  const o = ok(await sure('GET', `/api/pos/orders/${id}`), 'Order');
  lines += o.items.filter((i) => i.status !== 'VOID').length;
  if (o.status !== 'PAID') unpaid++;
}
const numbers = (await billsOfOutlet())
  .filter((c) => ids.has(c.orderId) && c.status !== 'CANCELLED')
  .map((c) => c.number);
const result = {
  devices: DEVICES,
  ordersSent: sent.length,
  ordersOnServer: ids.size,
  linesOnServer: lines,
  bills: numbers.length,
  billNumbersTwice: numbers.length - new Set(numbers).size,
  notPaid: unpaid,
  timesServerDidNotAnswer: down,
  refused,
  pass:
    ids.size === sent.length &&
    lines === sent.length &&
    numbers.length === sent.length &&
    numbers.length === new Set(numbers).size &&
    unpaid === 0,
};
console.log(JSON.stringify(result));
process.exit(result.pass ? 0 : 1);
