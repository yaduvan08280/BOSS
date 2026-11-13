#!/usr/bin/env node
// Sets a MONO company up as "Tora Skylounge" for a demonstration, through MONO's own API.
//   MONO_PASSWORD=… node deploy/demo/tora/run.mjs --url=https://your-mono --mobile=98xxxxxxxx
// Safe to run again: what already exists (by name) is kept.
import { part, signIn } from './client.mjs';
import * as org from './org.mjs';
import * as work from './work.mjs';
import * as kitchen from './kitchen.mjs';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = String(arg('url', process.env.MONO_URL ?? 'http://localhost:5173')).replace(/\/$/, '');
const mobile = arg('mobile', process.env.MONO_MOBILE);
const password = process.env.MONO_PASSWORD;
const only = arg('only', '');
if (!mobile || !password) {
  console.error('Give the owner\'s sign-in: --mobile=… and the password in MONO_PASSWORD.');
  process.exit(2);
}

const api = await signIn(base, mobile, password, arg('company', undefined));
const me = await api.get('/api/auth/me');
console.log(`Signed in to ${me.company.name} as ${me.user.name} (${me.user.roleName}) at ${base}`);
const ctx = {
  base, api, me,
  staffPassword: arg('staff-password', process.env.TORA_STAFF_PASSWORD ?? 'Tora@2026'),
  ids: { branches: {}, locations: {}, depts: {}, desigs: {}, shifts: {}, people: {} },
  sessions: new Map(),
  /** The API as one of the demo people (signed in once, then kept). */
  as: async (key) => {
    if (key === 'owner') return api;
    if (!ctx.sessions.has(key))
      ctx.sessions.set(key, await signIn(base, ctx.ids.people[key].mobile, ctx.staffPassword, me.company.id));
    return ctx.sessions.get(key);
  },
};
const report = [];
// Parts that only look things up when they are already there — later parts need their ids.
const ALWAYS = ['structure', 'people', 'money', 'items'];
const PARTS = [
  ['company', 'Company profile', org.company],
  ['structure', 'Branches, locations, departments, shifts', org.structure],
  ['people', 'People, heads and managers', org.people],
  ['flows', 'Business Engine: who runs each module', work.flowSettings],
  ['tasks', 'Delegation sheet', work.tasks],
  ['checklists', 'Checklists', work.checklists],
  ['slips', 'Help slips and help tickets', work.slipsAndTickets],
  ['ea', 'EA board', work.eaBoard],
  ['money', 'Taxes, payment modes, hospitality pack', kitchen.money],
  ['items', 'Kitchen and bar items with recipes', kitchen.items],
  ['stock', 'Opening stock, purchase, transfers, wastage', kitchen.stock],
];
for (const [key, name, fn] of PARTS) {
  if (only && !only.split(',').includes(key) && !ALWAYS.includes(key)) continue;
  await part(report, name, () => fn(ctx));
}
const failed = report.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} part(s) had a problem — see ✗ above.` : '\nAll parts done.');
process.exit(failed.length ? 1 : 0);
