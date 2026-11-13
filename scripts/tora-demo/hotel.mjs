// Stage 11: Tora Stays (Vaishali) — bookings, check-ins with KYC, folio charges, an advance, a foreign guest (Form C),
// a wedding group block, a guest request, housekeeping, and banquet events in the banquet module.
import fs from 'node:fs';
import { as, dayStr } from './people.mjs';
import { photo } from './png.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const { br, uid: U, out } = ids;
const owner = await as('owner');
const neha = await as('neha'), arjun = await as('arjun');
const modes = await owner.get('/api/money/modes');
const mode = (n) => modes.find((m) => m.name.startsWith(n)).id;
const tryit = async (label, fn) => { try { return await fn(); } catch (e) { console.log(label, e.message.slice(0, 300)); } };
const plans = await owner.get('/api/hotel/plans?branchId=' + br.vai);
const P = Object.fromEntries((plans.plans ?? plans).map((p) => [p.code, p.id]));
const rooms = await owner.get('/api/hosp/rooms');
const T = Object.fromEntries(rooms.types.map((t) => [t.code, t.id]));
const R = Object.fromEntries(rooms.rooms.map((r) => [r.number, r.id]));

const existing = await owner.get(`/api/hotel/stays?branchId=${br.vai}`).catch(() => []);
if ((existing.stays ?? existing).length) { console.log('stays exist'); }
else {
  // [name, mobile, type, plan, arrive, nights, room, checkin?, kyc, extras]
  const S = [
    ['Rajeev Malhotra', '+919811200201', 'PRM', 'BAR-CP', 0, 2, '201', true, { idType: 'Aadhaar', idNumber: 'XXXX-XXXX-4412', nationality: 'Indian', address: 'Sector 21, Gurugram' }, ['laundry_shirt', 'airport']],
    ['Emma Clarke', '+447700900301', 'STE', 'BAR-CP', 0, 3, '301', true, { idType: 'Passport', idNumber: 'GBR 5512 9981', nationality: 'British', passportNo: 'GBR55129981', visaNo: 'IN-EV-77120', visaExpiry: dayStr(60), arrivedIndiaOn: dayStr(-3), arrivedFrom: 'London', nextDestination: 'Udaipur', purpose: 'Tourism' }, []],
    ['Sandeep Choudhary', '+919414200203', 'DLX', 'BAR-EP', 0, 1, '104', true, { idType: 'Driving licence', idNumber: 'RJ14 2016 0099812', nationality: 'Indian', address: 'Sikar' }, []],
    ['Ananya Iyer', '+919845200204', 'DLX', 'BAR-CP', 0, 2, null, false, null, []],
    ['Corporate – TechNova (Mr. Ravi Kumar)', '+919950200205', 'PRM', 'BAR-EP', 1, 3, null, false, null, []],
    ['Neeraj Goyal', '+919829200206', 'DLX', 'BAR-EP', 2, 2, null, false, null, []],
  ];
  for (const [name, mobile, type, plan, d, nights, room, checkin, kyc, extras] of S) {
    const st = await tryit('stay ' + name, () => neha.post('/api/hotel/stays', {
      branchId: br.vai, ratePlanId: P[plan], roomTypeId: T[type], ...(room ? { roomId: R[room] } : {}), arrive: dayStr(d), depart: dayStr(d + nights),
      adults: 2, guest: { mobile, name }, source: name.startsWith('Corporate') ? 'PHONE' : 'DIRECT', note: name === 'Emma Clarke' ? 'Booked via Booking.com (channel manager to be connected)' : undefined,
    }));
    if (!st) continue;
    const id = st.id ?? st.stay?.id;
    if (checkin) {
      const idPhotoId = (await neha.upload(photo(1), 'id.png')).id, signatureId = (await neha.upload(photo(4), 'signature.png')).id;
      await tryit('checkin', () => neha.post(`/api/hotel/stays/${id}/check-in`, { roomId: R[room], kyc: { ...kyc, idPhotoId, signatureId }, keys: 2 }));
      await tryit('advance', () => neha.post(`/api/hotel/stays/${id}/advance`, { modeId: mode('Card'), amount: 500000, reference: 'HDFC 7731' }));
      for (const x of extras) await tryit('charge', () => arjun.post(`/api/hotel/stays/${id}/charges`, { kind: x.startsWith('laundry') ? 'LAUNDRY' : 'EXTRA', extraKey: x, qty: x.startsWith('laundry') ? 3 : 1 }));
    }
    if (name === 'Rajeev Malhotra') await tryit('request', () => arjun.post(`/api/hotel/stays/${id}/request`, { text: 'Extra pillows and an iron, please' }));
  }
  console.log('stays ok');
}

// Room service to room 201 charged to the room (POS → folio)
const rs = await as('arjun');
const menu = await owner.get('/api/hosp/menu');
const M = Object.fromEntries(menu.items.map((i) => [i.name, i.id]));
await tryit('room service', async () => {
  const o = await rs.post('/api/pos/orders', { outletId: out.ird, type: 'ROOM_SERVICE', roomNo: '201', covers: 2, stewardId: U.arjun });
  await rs.post(`/api/pos/orders/${o.id}/items`, { items: [{ menuItemId: M['Paneer Butter Masala'], variantKey: 'full', qty: 1 }, { menuItemId: M['Butter Naan'], qty: 4 }, { menuItemId: M['Fresh Lime Soda'], qty: 2 }], fire: true });
  const c = await (await as('neha')).post(`/api/pos/orders/${o.id}/check`, {});
  await (await as('neha')).post(`/api/pos/checks/${c.id}/pay`, { payments: [{ modeId: mode('Charge to room'), amount: Number(c.total), reference: '201' }] });
});
console.log('room service ok');

// Banquet module: events with quotes, advances, BEO
const vivek = await as('vivek'), priya = await as('priya');
const halls = await owner.get('/api/banquets/halls?branchId=' + br.vai);
const H = Object.fromEntries((halls.halls ?? halls).map((h) => [h.name, h.id]));
const hallsM = await owner.get('/api/banquets/halls?branchId=' + br.mur);
const HM = Object.fromEntries((hallsM.halls ?? hallsM).map((h) => [h.name, h.id]));
const evs = [];
for (const b of [br.vai, br.mur]) { const x = await owner.get('/api/banquets/events?branchId=' + b); evs.push(...(x.events ?? x)); }
fs.writeFileSync(new URL('./events-sample.json', import.meta.url), JSON.stringify(evs, null, 1).slice(0, 3000));
const pkgList = await owner.get('/api/banquets/packages');
const pkgs = Object.fromEntries((pkgList.packages ?? pkgList).map((p) => [p.name, p.id]));
fs.writeFileSync(new URL('./halls-sample.json', import.meta.url), JSON.stringify({ halls, pkgs }, null, 1).slice(0, 4000));
const have = new Set(evs.map((e) => e.guest?.name ?? e.guestName ?? e.title ?? e.name));
{
  const E = [
    [priya, br.vai, 'Agarwal family – wedding reception', '+919829099001', 'Wedding reception', 40, '19:00', '23:30', ['Tora Grand Ballroom'], 'Round tables', 300, 'Gold veg package', 280, 'confirm'],
    [vivek, br.vai, 'TechNova Solutions – annual meet', '+919950099002', 'Conference', 12, '09:30', '18:00', ['Tora Grand Ballroom'], 'Theatre', 120, 'Silver veg package', 110, 'quote'],
    [priya, br.vai, 'Gupta family – 50th birthday', '+919414099003', 'Birthday', 6, '19:30', '23:00', ['Terrace Lawn'], 'Floating', 90, 'Gold veg package', 80, 'confirm'],
    [await as('karan'), br.mur, 'Infosys Jaipur – team night', '+919950012345', 'Corporate party', 9, '20:00', '23:30', ['Rooftop private party (4th floor)'], 'Floating', 60, 'Rooftop party package (2 mocktails)', 60, 'quote'],
  ];
  for (const [who, branchId, name, mobile, occasion, d, from, to, hallNames, style, covers, pkg, guaranteed, then] of E) {
    if (have.has(name)) continue;
    const hmap = branchId === br.mur ? HM : H;
    const e = await tryit('event ' + name, () => who.post('/api/banquets/events', { branchId, guest: { mobile, name }, occasion, day: dayStr(d), startMin: Number(from.slice(0, 2)) * 60 + Number(from.slice(3)), endMin: Number(to.slice(0, 2)) * 60 + Number(to.slice(3)), hallIds: hallNames.map((h) => hmap[h]), style, expectedCovers: covers }));
    if (!e) continue;
    const id = e.id ?? e.event?.id;
    const q = await tryit('quote', () => who.post(`/api/banquets/events/${id}/quote`, { packageId: pkgs[pkg], guaranteedCovers: guaranteed, extras: [{ name: 'Stage & floral decor', amount: occasion === 'Conference' ? 2500000 : 7500000, taxCode: 'SERVICE' }, { name: 'DJ & sound', amount: 2500000, taxCode: 'SERVICE' }] }));
    if (then === 'confirm' && q) {
      const total = Number(q.quote?.total ?? q.total ?? 0);
      await tryit('advance', () => (who).post(`/api/banquets/events/${id}/advance`, { modeId: mode('Bank'), amount: Math.ceil(total * 0.3), reference: 'NEFT UTR HDFC2611' + String(id).slice(0, 6) }));
      await tryit('confirm', () => vivek.post(`/api/banquets/events/${id}/confirm`, {}));
      await tryit('beo', () => vivek.post(`/api/banquets/events/${id}/beo`, { kitchen: `Gold veg menu for ${guaranteed}; live counters: chaat and pasta. Jain food for 20.`, service: '1 steward per 15 guests; welcome mocktails at the entrance', housekeeping: 'Bridal room on 3rd floor ready by 4 pm; washrooms every 30 min', send: true }));
    }
  }
  console.log('banquet events ok');
}
