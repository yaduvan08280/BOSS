// Stage 10: table reservations (tonight + the weekend), a deposit, a waitlist, guest profiles with consent.
import fs from 'node:fs';
import { as, dayStr } from './people.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const { out } = ids;
const riya = await as('riya');
const owner = await as('owner');
const modes = await owner.get('/api/money/modes');
const mode = (n) => modes.find((m) => m.name.startsWith(n)).id;
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const tryit = async (label, fn) => { try { return await fn(); } catch (e) { console.log(label, e.message.slice(0, 260)); } };

// [outlet, day offset, time, party, name, mobile, occasion, requests, source, then]
const B = [
  ['roof', 0, '20:00', 4, 'Rahul Khandelwal', '+919829100101', 'Anniversary', 'Corner table with the city view; cake at 9 pm', 'PHONE', 'confirm'],
  ['roof', 0, '20:30', 2, 'Sneha Agarwal', '+919829100102', null, null, 'ONLINE', null],
  ['roof', 0, '21:00', 6, 'Mohit Saini', '+919829100103', 'Birthday', 'Jain food for 2 guests', 'PHONE', 'confirm'],
  ['lounge', 0, '21:30', 8, 'Vikas Meena', '+919829100104', 'Bachelor party', 'Near the dance floor', 'PHONE', 'confirm'],
  ['lounge', 0, '20:00', 3, 'Ritu Sharma', '+919829100105', null, null, 'WALK_IN', 'seat'],
  ['roof', 1, '20:00', 10, 'Deepika Rathore', '+919829100106', 'Birthday', 'Gazebo; decoration by guest', 'PHONE', 'deposit'],
  ['roof', 1, '21:00', 4, 'Amit Jain', '+919829100107', 'Business dinner', null, 'ONLINE', null],
  ['lounge', 1, '22:00', 12, 'Kunal Verma', '+919829100108', 'Bachelor party', 'Bottle service', 'PHONE', null],
  ['roof', 2, '19:30', 5, 'Pooja Mathur', '+919829100109', 'Anniversary', null, 'ONLINE', null],
  ['mnr', 1, '20:30', 6, 'Harshit Bhatia', '+919829100110', 'Birthday', null, 'PHONE', null],
];
for (const [o, d, t, size, name, mobile, occasion, requests, source, then] of B) {
  const r = await tryit(name, () => riya.post('/api/reservations', {
    outletId: out[o], day: dayStr(d), startMin: hm(t), partySize: size, guest: { mobile, name },
    ...(occasion ? { occasion } : {}), ...(requests ? { requests } : {}), source,
  }));
  if (!r) continue;
  const id = r.id ?? r.reservation?.id;
  if (then === 'confirm') await tryit('confirm', () => riya.post(`/api/reservations/${id}/act`, { action: 'confirm' }));
  if (then === 'deposit') await tryit('deposit', () => riya.post(`/api/reservations/${id}/deposit`, { modeId: mode('UPI'), reference: 'UPI 4401 2299 1188' }));
  if (then === 'seat') { await tryit('arrive', () => riya.post(`/api/reservations/${id}/act`, { action: 'arrive' })); await tryit('seat', () => riya.post(`/api/reservations/${id}/act`, { action: 'seat' })); }
}
console.log('bookings ok');

// Waitlist on the rooftop
for (const [size, name, mobile] of [[4, 'Arjun Singh', '+919829100121'], [2, 'Megha Gupta', '+919829100122'], [6, 'Saurabh Jain', '+919829100123']])
  await tryit('wait', () => riya.post('/api/reservations/waitlist', { outletId: out.roof, partySize: size, name, mobile, note: 'Walked in, OK to wait 20 min' }));

// Regular guests: profiles, preferences, marketing consent
const guests = await riya.get('/api/guests');
const G = guests.guests ?? guests;
const profile = {
  'Rahul Khandelwal': { anniversary: '2019-11-14', preferences: 'Old Fashioned, window table', tags: ['Regular', 'VIP'] },
  'Deepika Rathore': { birthday: '1998-11-15', allergies: 'Peanuts', tags: ['Birthday'] },
  'Vikas Meena': { preferences: 'Royal Stag + soda; loud music area', tags: ['Bachelor parties'] },
  'Amit Jain': { preferences: 'Jain food (no onion/garlic)', tags: ['Corporate'] },
};
for (const g of G) {
  const p = profile[g.name];
  if (!p) continue;
  await tryit('guest', () => riya.patch(`/api/guests/${g.id}`, p));
  await tryit('consent', () => riya.post(`/api/guests/${g.id}/consent`, { marketing: true, source: 'STAFF', note: 'Agreed at the table to get offers on WhatsApp' }));
}
console.log('guests ok');
