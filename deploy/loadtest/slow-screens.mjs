#!/usr/bin/env node
// Reads every list and every "one row" address of the API as one signed-in person and prints the slow ones.
// Run it against a server whose database was grown with grow.mjs (never against live data: it is a few
// thousand requests). The server must not be in production mode (the route list comes from /api/docs/json).
//
//   BASE=http://localhost:3130 LOGIN=9000000000 PASSWORD=Demo1234 node deploy/loadtest/slow-screens.mjs
//
// Settings (env): SLOW_MS (200), PER_ROUTE (2 real ids tried for each address with a parameter).
const env = process.env;
const BASE = (env.BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const ORIGIN = env.ORIGIN ?? BASE;
const SLOW = Number(env.SLOW_MS ?? 200);
const PER_ROUTE = Number(env.PER_ROUTE ?? 2);

let cookie = '';
const LIMIT = Number(env.LIMIT_MS ?? 30_000);
async function call(path) {
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { origin: ORIGIN, cookie },
      signal: AbortSignal.timeout(LIMIT),
    });
    const text = await res.text();
    return { status: res.status, ms: performance.now() - started, text, bytes: text.length };
  } catch {
    // No answer in time: the slowest kind of slow.
    return { status: 0, ms: performance.now() - started, text: '', bytes: 0 };
  }
}
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: env.LOGIN, password: env.PASSWORD }),
});
if (!login.ok) {
  console.error(`Sign-in failed: ${login.status} ${await login.text()}`);
  process.exit(2);
}
cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');

const spec = await (await fetch(`${BASE}/api/docs/json`)).json();
const gets = Object.entries(spec.paths ?? {})
  .filter(([path, ops]) => ops.get && !path.startsWith('/api/events') && !path.startsWith('/api/docs'))
  .map(([path]) => path.replace(/\{(\w+)\}/g, ':$1'));
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const usual = `from=${day(-30)}&to=${day(1)}&date=${day(0)}&day=${day(0)}&month=${day(0).slice(0, 7)}&week=${day(0)}&at=${day(0)}`;
async function read(path) {
  const first = await call(path);
  return first.status === 400 ? call(`${path}?${usual}`) : first;
}
const idsOf = (text) => {
  const out = [];
  const walk = (v) => {
    if (out.length >= 6 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v.id === 'string' && /^[a-z][a-z0-9]{23}$/.test(v.id) && !out.includes(v.id)) out.push(v.id);
    Object.values(v).forEach(walk);
  };
  try {
    walk(JSON.parse(text));
  } catch {
    /* a file */
  }
  return out;
};

const rows = [];
const seen = new Map();
for (const path of gets.filter((p) => !p.includes(':'))) {
  const r = await read(path);
  rows.push({ path, ...r });
  if (r.status === 0 || r.ms > SLOW)
    console.error(`${Math.round(r.ms)} ms  ${r.status || 'no answer'}  ${path}`);
  if (r.status === 200) seen.set(path, idsOf(r.text));
}
for (const path of gets.filter((p) => p.includes(':'))) {
  const head = path.slice(0, path.indexOf(':')).replace(/\/$/, '');
  const lists = [...seen.keys()]
    .filter((l) => head === l || head.startsWith(`${l}/`) || l.startsWith(`${head}/`))
    .sort((a, b) => b.length - a.length);
  const ids = [...new Set(lists.flatMap((l) => seen.get(l)))].slice(0, PER_ROUTE);
  for (const id of ids) {
    const r = await read(path.replace(/:[A-Za-z]+/g, id));
    if (r.status === 200 || r.status === 0) rows.push({ path, ...r });
  }
}

const ok = rows.filter((r) => r.status === 200);
const slow = rows
  .filter((r) => (r.status === 200 || r.status === 0) && r.ms > SLOW)
  .sort((a, b) => b.ms - a.ms);
const big = ok.filter((r) => r.bytes > 1_000_000).sort((a, b) => b.bytes - a.bytes);
const sorted = ok.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) =>
  Math.round(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0);
console.log(
  `${rows.length} reads, ${ok.length} answered 200 · p50 ${pct(50)} ms · p95 ${pct(95)} ms · p99 ${pct(99)} ms · slowest ${Math.round(sorted.at(-1) ?? 0)} ms`,
);
console.log(`\nSlower than ${SLOW} ms: ${slow.length}`);
for (const r of slow)
  console.log(
    `  ${String(Math.round(r.ms)).padStart(6)} ms  ${String(Math.round(r.bytes / 1024)).padStart(6)} KB  ${r.path}`,
  );
console.log(`\nAnswers over 1 MB (a list with no page size?): ${big.length}`);
for (const r of big) console.log(`  ${String(Math.round(r.bytes / 1024)).padStart(6)} KB  ${r.path}`);
const failed = rows.filter((r) => r.status >= 500);
const silent = rows.filter((r) => r.status === 0);
console.log(`\nNo answer in ${LIMIT / 1000} s: ${silent.length}`);
for (const r of silent) console.log(`  ${r.path}`);
console.log(`\nServer errors: ${failed.length}`);
for (const r of failed) console.log(`  ${r.status}  ${r.path}`);
process.exit(slow.length || failed.length ? 1 : 0);
