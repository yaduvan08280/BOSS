// Finish the hotel + banquet story: check-ins with ID photo & signature, charges, a guest request, room service to the room,
// banquet quotes / advances / confirmations / BEOs.
import fs from 'node:fs';
import { as, dayStr } from './people.mjs';
import { photo } from './png.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const { br } = ids;
const owner = await as('owner');
const neha = await as('neha'), arjun = await as('arjun'), vivek = await as('vivek');
const modes = await owner.get('/api/money/modes');
const mode = (n) => modes.find((m) => m.name.startsWith(n)).id;
const tryit = async (label, fn) => { try { return await fn(); } catch (e) { console.log(label, e.message.slice(0, 300)); } };
const rooms = await owner.get('/api/hosp/rooms');
const R = Object.fromEntries(rooms.rooms.map((r) => [r.number, r.id]));

const stays = await owner.get(`/api/hotel/stays?branchId=${br.vai}`);
const list = stays.stays ?? stays;
const KYC = {
  'Rajeev Malhotra': ['201', { idType: 'Aadhaar', idNumber: 'XXXX-XXXX-4412', nationality: 'Indian', address: 'Sector 21, Gurugram' }, ['laundry_shirt', 'airport']],
  'Emma Clarke': ['301', { idType: 'Passport', idNumber: 'GBR 5512 9981', nationality: 'British', passportNo: 'GBR55129981', visaNo: 'IN-EV-77120', visaExpiry: dayStr(60), arrivedIndiaOn: dayStr(-3), arrivedFrom: 'London', nextDestination: 'Udaipur', purpose: 'Tourism' }, []],
  'Sandeep Choudhary': ['104', { idType: 'Driving licence', idNumber: 'RJ14 2016 0099812', nationality: 'Indian', address: 'Sikar' }, ['laundry_suit']],
};
for (const st of list) {
  const name = st.guest?.name ?? st.guestName;
  const k = KYC[name];
  if (!k || st.status !== 'BOOKED') continue;
  const [room, kyc, extras] = k;
  const idPhotoId = (await neha.upload(photo(1), 'id.png')).id, signatureId = (await neha.upload(photo(4), 'signature.png')).id;
  await tryit('checkin ' + name, () => neha.post(`/api/hotel/stays/${st.id}/check-in`, { roomId: R[room], kyc: { ...kyc, idPhotoId, signatureId }, keys: 2 }));
  await tryit('advance', () => neha.post(`/api/hotel/stays/${st.id}/advance`, { modeId: mode('Card'), amount: 500000, reference: 'HDFC 7731' }));
  for (const x of extras) await tryit('charge', () => arjun.post(`/api/hotel/stays/${st.id}/charges`, { kind: x.startsWith('laundry') ? 'LAUNDRY' : 'EXTRA', extraKey: x, qty: x === 'laundry_shirt' ? 3 : 1 }));
  if (name === 'Rajeev Malhotra') await tryit('request', () => arjun.post(`/api/hotel/stays/${st.id}/request`, { text: 'Extra pillows and an iron, please' }));
}
console.log('check-ins ok');

// The room-service bill waiting for room 201
const checks = await neha.get(`/api/pos/outlets/${ids.out.ird}/checks`);
for (const c of checks) if (c.status !== 'PAID' && c.status !== 'CANCELLED')
  await tryit('room charge', () => neha.post(`/api/pos/checks/${c.id}/pay`, { payments: [{ modeId: mode('Charge to room'), amount: Number(c.total), reference: '201' }] }));
console.log('room service ok');

// Banquets
const evs = [];
for (const b of [br.vai, br.mur]) { const x = await owner.get('/api/banquets/events?branchId=' + b); evs.push(...(x.events ?? x)); }
const pk = await owner.get('/api/banquets/packages');
const P = Object.fromEntries((pk.packages ?? pk).map((p) => [p.name, p.id]));
const extras = (conf) => [{ name: 'Stage & floral decor', amount: conf ? 2500000 : 7500000, taxCode: 'SERVICE' }, { name: 'DJ & sound', amount: 2500000, taxCode: 'SERVICE' }];
const plan = {
  'Agarwal family – wedding reception': ['Gold veg package', 220, true],
  'Gupta family – 50th birthday': ['Gold veg package', 80, true],
  'TechNova Solutions – annual meet': ['Silver veg package', 110, false],
  'Infosys Jaipur – team night': ['Rooftop party package (2 mocktails)', 60, false],
};
for (const e of evs) {
  const name = e.guest?.name; const p = plan[name];
  if (!p) continue;
  const [pkg, covers, confirm] = p;
  if (e.status === 'ENQUIRY' || !e.quote?.total)
    await tryit('quote ' + name, () => vivek.post(`/api/banquets/events/${e.id}/quote`, { packageId: P[pkg], guaranteedCovers: covers, extras: extras(name.includes('TechNova')) }));
  if (!confirm) continue;
  const full = await owner.get(`/api/banquets/events/${e.id}`);
  const total = Number(full.quote?.total ?? full.total ?? 0);
  const due = Number(full.advanceDue ?? Math.ceil(total * 0.3));
  if (full.status === 'QUOTED') {
    await tryit('advance ' + name, () => vivek.post(`/api/banquets/events/${e.id}/advance`, { modeId: mode('Bank'), amount: Math.max(due, 1), reference: 'NEFT UTR HDFC26111' + e.number.slice(-2) }));
    await tryit('confirm', () => vivek.post(`/api/banquets/events/${e.id}/confirm`, {}));
    await tryit('beo', () => vivek.post(`/api/banquets/events/${e.id}/beo`, { kitchen: `${pkg} for ${covers}; live chaat and pasta counters; Jain food for 20.`, service: '1 steward per 15 guests; welcome mocktails at the entrance', housekeeping: 'Bridal / host room ready by 4 pm; washrooms checked every 30 min', send: true }));
  }
}
console.log('banquets ok');
