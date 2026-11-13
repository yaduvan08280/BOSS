// Sign in as any TORA demo person by key (data.mjs PEOPLE) — sessions are cached.
import { session } from './api.mjs';
import { PEOPLE, mobileOf, DEMO_PASSWORD } from './data.mjs';

const cache = new Map();
export async function as(key) {
  if (key === 'owner') {
    if (!cache.has(key)) cache.set(key, await session(process.env.OWNER_ID, process.env.OWNER_PW));
    return cache.get(key);
  }
  if (!cache.has(key)) {
    const p = PEOPLE.find((x) => x[0] === key);
    if (!p) throw new Error('no person ' + key);
    cache.set(key, await session(mobileOf(p[2]), DEMO_PASSWORD));
  }
  return cache.get(key);
}
/** ISO instant for "today + d days at HH:mm" in IST. */
export function at(d, hhmm = '18:00') {
  const now = new Date(Date.now() + 5.5 * 3600e3);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d));
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getTime() + (h * 60 + m - 330) * 60e3).toISOString();
}
export function dayStr(d) {
  const now = new Date(Date.now() + 5.5 * 3600e3);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d)).toISOString().slice(0, 10);
}
