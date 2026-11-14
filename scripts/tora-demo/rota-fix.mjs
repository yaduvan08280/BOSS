// The first import left each 7-day-shift person's "rota day" without punches, which MONO rightly reads as absent
// (their shift works every day). Import those days as worked, so only the random absences stay.
import { as } from './people.mjs';
const owner = await as('owner');
const users = (await owner.get('/api/org/users')).filter((u) => u.email?.endsWith('@toraskylounge.demo'));
const shifts = Object.fromEntries((await owner.get('/api/org/shifts')).map((s) => [s.id, s]));
const pad = (n) => String(n).padStart(2, '0');
const stamp = (date, min) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(min);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const lines = [];
for (const u of users) {
  const sh = shifts[u.shiftId];
  if (!sh || sh.weekdays.length !== 7) continue;
  for (let d = 1; d <= 13; d++) {
    const date = `2026-11-${pad(d)}`;
    const wd = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (wd !== (u.code.charCodeAt(u.code.length - 1) % 7) + 1) continue;
    if (['2026-11-06', '2026-11-10', '2026-11-11'].includes(date) && /Tenzin|Sonu/.test(u.name)) continue;
    const end = sh.endMin > sh.startMin ? sh.endMin : sh.endMin + 1440;
    lines.push(`${u.code},${stamp(date, sh.startMin - 3)},IN`, `${u.code},${stamp(date, end + 12)},OUT`);
  }
}
console.log(JSON.stringify(await owner.post('/api/hr/attendance/import', { csv: lines.join('\n') })), lines.length / 2, 'days');
