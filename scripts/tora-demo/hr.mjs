// Stage 13: HR — holidays, leave types, punches for tonight's lounge team, a leave request that needs a Buddy.
import fs from 'node:fs';
import { as, dayStr } from './people.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const U = ids.uid;
const owner = await as('owner');
const tryit = async (label, fn) => { try { return await fn(); } catch (e) { console.log(label, e.message.slice(0, 250)); } };

const hol = await owner.get('/api/hr/holidays').catch(() => []);
const haveH = new Set((hol.holidays ?? hol).map((h) => h.date));
for (const [date, name, type] of [
  ['2026-11-24', 'Guru Nanak Jayanti', 'FESTIVAL'], ['2026-12-25', 'Christmas', 'FESTIVAL'], ['2027-01-26', 'Republic Day', 'NATIONAL'],
  ['2027-03-04', 'Holi (Dhulandi)', 'FESTIVAL'], ['2027-03-30', 'Rajasthan Day', 'OPTIONAL'],
]) if (!haveH.has(date)) await tryit('holiday', () => owner.post('/api/hr/holidays', { date, name, type }));
// Hospitality staff work on holidays — the office team gets them off.
const lt = await owner.get('/api/hr/leave/types').catch(() => []);
const haveL = new Set((lt.types ?? lt).map((t) => t.code));
for (const [code, name, yearlyQuota, carryForward, paid] of [['CL', 'Casual leave', 8, 0, true], ['SL', 'Sick leave', 6, 0, true], ['EL', 'Earned leave', 12, 6, true], ['WO', 'Weekly off swap', 0, 0, true], ['LWP', 'Leave without pay', 0, 0, false]])
  if (!haveL.has(code)) await tryit('leave type', () => owner.post('/api/hr/leave/types', { code, name, yearlyQuota, carryForward, paid }));
console.log('holidays & leave types ok');

// Punches — Murlipura geo (Janak Square, Kedia Palace Rd) — tonight's lounge team
await tryit('fence', () => owner.patch(`/api/org/branches/${ids.br.mur}`, { details: { fences: [{ name: 'Janak Square', lat: 26.9649, lng: 75.7725, radiusM: 150 }] } }));
for (const k of ['karan', 'imran', 'deepak', 'rahul', 'vishal', 'riya', 'manish', 'aman', 'joel', 'harish', 'vinod', 'mohan', 'suresh', 'lucky'])
  await tryit('punch ' + k, async () => (await as(k)).post('/api/hr/punch', { type: 'IN', lat: 26.9649 + Math.random() * 0.0005, lng: 75.7725 + Math.random() * 0.0005, accuracy: 18 }));
console.log('punches ok');

// Leave: Deepak (captain) asks 2 days off next week — his open work needs a Buddy
const types = await owner.get('/api/hr/leave/types');
const CL = (types.types ?? types).find((t) => t.code === 'CL').id;
await tryit('leave', async () => (await as('deepak')).post('/api/hr/leave', { leaveTypeId: CL, from: dayStr(4), to: dayStr(5), reason: 'Sister’s wedding in Dausa' }));
await tryit('leave2', async () => (await as('tenzin')).post('/api/hr/leave', { leaveTypeId: CL, from: dayStr(2), to: dayStr(2), reason: 'Family function' }));
console.log('leave ok');
