// November attendance for the TORA demo: joining dates, Diwali, two approved leaves, and a biometric-device CSV of
// 1–13 November imported through HR → Attendance → Import (the same path a real device file takes).
// Days with no punch are settled afterwards by the nightly job (`settle-days.ts`).
import fs from 'node:fs';
import { as } from './people.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const owner = await as('owner');
const tryit = async (label, fn) => { try { return await fn(); } catch (e) { console.log(label, e.message.slice(0, 200)); } };

// Joined in April (HR details), so the whole month counts.
const users = await owner.get('/api/org/users');
const staff = users.filter((u) => u.email?.endsWith('@toraskylounge.demo'));
for (const u of staff) await tryit('doj', () => owner.patch(`/api/org/users/${u.id}`, { hr: { doj: '2026-04-01' } }));

// Diwali week
for (const [date, name] of [['2026-11-08', 'Diwali'], ['2026-11-09', 'Govardhan Puja']])
  await tryit('holiday', () => owner.post('/api/hr/holidays', { date, name, type: 'FESTIVAL' }));

// The device file: code, date-time, IN/OUT. Seeded so it is the same every run.
let seed = 42;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const shifts = Object.fromEntries((await owner.get('/api/org/shifts')).map((s) => [s.id, s]));
const pad = (n) => String(n).padStart(2, '0');
const stamp = (date, min) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(min);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const lines = [];
const leaveDays = { tenzin: ['2026-11-06'], sonu: ['2026-11-10', '2026-11-11'] };
for (const u of staff) {
  const key = Object.entries(ids.uid).find(([, v]) => v === u.id)?.[0];
  const sh = shifts[u.shiftId];
  if (!sh) continue;
  for (let d = 1; d <= 13; d++) {
    const date = `2026-11-${pad(d)}`;
    const wd = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (!sh.weekdays.includes(wd)) continue;
    if (leaveDays[key]?.includes(date)) continue;
    // A weekly day off by rota for the 7-day shifts (each person on a different weekday).
    if (sh.weekdays.length === 7 && wd === (u.code.charCodeAt(u.code.length - 1) % 7) + 1) continue;
    const r = rnd();
    if (r < 0.035) continue; // absent
    const late = r > 0.88 ? 15 + Math.round(rnd() * 60) : Math.round(rnd() * 8) - 6;
    const start = sh.startMin + late;
    const end = (sh.endMin > sh.startMin ? sh.endMin : sh.endMin + 1440) + Math.round(rnd() * 50) - 5;
    const early = r > 0.035 && r < 0.06 ? -300 : 0; // left after half a shift
    lines.push(`${u.code},${stamp(date, start)},IN`);
    if (r > 0.06 && r < 0.075) continue; // forgot to punch out
    lines.push(`${u.code},${stamp(date, end + early)},OUT`);
  }
}
const res = await owner.post('/api/hr/attendance/import', { csv: ['Code,Time,Direction', ...lines].join('\n') });
console.log('import', JSON.stringify(res).slice(0, 300), lines.length, 'lines');

// Two leaves taken earlier this month, approved by the HODs
const types = await owner.get('/api/hr/leave/types');
const CL = (types.types ?? types).find((t) => t.code === 'CL').id;
const SL = (types.types ?? types).find((t) => t.code === 'SL').id;
for (const [who, type, from, to, reason] of [['tenzin', CL, '2026-11-06', '2026-11-06', 'Family function'], ['sonu', SL, '2026-11-10', '2026-11-11', 'Fever']]) {
  const l = await tryit('leave', async () => (await as(who)).post('/api/hr/leave', { leaveTypeId: type, from, to, reason }));
  if (l) await tryit('approve', async () => owner.post(`/api/hr/leave/${l.id ?? l.request?.id}/decide`, { approve: true, note: 'OK' }));
}
console.log('attendance ok');
