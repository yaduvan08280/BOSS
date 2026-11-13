// Stage 1: company profile, entities, branches, locations, departments, designations, shifts, people.
import { session } from './api.mjs';
import * as D from './data.mjs';

const s = await session(process.env.OWNER_ID, process.env.OWNER_PW);
const log = (...a) => console.log(...a);

// GSTIN check digit (same algorithm as @mono/shared gstinCheckDigit).
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstin = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CH.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return first14 + CH[(36 - (sum % 36)) % 36];
};

// Company
await s.put('/api/org/company', { ...D.COMPANY, gstin: gstin(D.ENTITIES[0].gstin14), pan: 'AAKCT4821M' });
const profile = await s.get('/api/org/company');
for (const [role, name, phone, email] of D.CONTACTS)
  if (!profile.contacts.some((c) => c.name === name)) await s.post('/api/org/contacts', { role, name, phone, email });
log('company ok');

// Entities, branches, locations
let st = await s.get('/api/branches/structure');
const ent = {};
for (const e of D.ENTITIES) {
  const found = st.entities.find((x) => x.name === e.name);
  const body = { name: e.name, kind: e.kind, state: e.state, taxId: gstin(e.gstin14), isDefault: e.isDefault, details: e.details };
  ent[e.key] = found ? found.id : (await s.post('/api/branches/entities', body)).id;
}
const br = {};
const existingBranches = await s.get('/api/org/branches');
for (const b of D.BRANCHES) {
  const found = existingBranches.find((x) => x.code === b.code);
  const body = {
    name: b.name, code: b.code, type: b.type, city: 'Jaipur', state: 'Rajasthan', entityId: ent[b.entity],
    isDefault: b.isDefault, details: { address: b.address, phone: b.phone, seriesCode: b.seriesCode, licences: b.licences },
  };
  br[b.key] = found ? (await s.patch(`/api/org/branches/${found.id}`, body), found.id) : (await s.post('/api/org/branches', body)).id;
}
st = await s.get('/api/branches/structure');
for (const [b, name, kind] of D.LOCATIONS)
  if (!st.locations.some((l) => l.name === name)) await s.post('/api/branches/locations', { name, branchId: br[b], kind });
log('entities/branches/locations ok', Object.keys(br).length);

// Departments, designations, shifts
const deps = async () => Object.fromEntries((await s.get('/api/org/departments')).map((d) => [d.name, d]));
let dep = await deps();
for (const [name, parent] of D.DEPARTMENTS) {
  if (!dep[name]) await s.post('/api/org/departments', { name, ...(parent ? { parentId: dep[parent].id } : {}) });
  dep = await deps();
}
let des = Object.fromEntries((await s.get('/api/org/designations')).map((d) => [d.name, d.id]));
for (const name of D.DESIGNATIONS) if (!des[name]) des[name] = (await s.post('/api/org/designations', { name })).id;
let sh = Object.fromEntries((await s.get('/api/org/shifts')).map((x) => [x.name, x.id]));
for (const [name, start, end, weekdays] of D.SHIFTS)
  if (!sh[name]) sh[name] = (await s.post('/api/org/shifts', { name, start, end, weekdays })).id;
log('departments/designations/shifts ok');

// People
const roles = Object.fromEntries((await s.get('/api/org/roles')).roles.flatMap((r) => [[r.key ?? r.name, r.id], [r.name, r.id]]));
let users = await s.get('/api/org/users');
const uid = {};
for (const [key, name, n, d, desig, role, b, shift, , , login = true] of D.PEOPLE) {
  const mobile = D.mobileOf(n);
  const found = users.find((u) => u.mobile === mobile || u.name === name);
  const body = {
    name, mobile, email: D.emailOf(name), roleId: roles[role], mainDepartmentId: dep[d].id, designationId: des[desig],
    branchId: br[b], shiftId: sh[shift], loginEnabled: login,
  };
  if (!roles[role]) throw new Error(`no role ${role}`);
  uid[key] = found ? found.id : (await s.post('/api/org/users', body)).id ?? null;
}
users = await s.get('/api/org/users');
for (const p of D.PEOPLE) uid[p[0]] = users.find((u) => u.name === p[1])?.id;
// Reporting lines, HODs
for (const [key, , , d, , , , , boss, hod] of D.PEOPLE) {
  if (boss) await s.patch(`/api/org/users/${uid[key]}`, { reportsToId: uid[boss] });
  if (hod) await s.patch(`/api/org/departments/${dep[d].id}`, { hodUserId: uid[key] });
}
log('people ok', users.length);
const fs = await import('node:fs');
fs.writeFileSync(new URL('./ids.json', import.meta.url), JSON.stringify({ ent, br, dep: Object.fromEntries(Object.entries(dep).map(([k, v]) => [k, v.id])), des, sh, uid, roles }, null, 1));
