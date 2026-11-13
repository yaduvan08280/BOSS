// Stage 4: table-booking rules, hotel rules + rate plans, banquet halls + packages, bar & compliance.
import fs from 'node:fs';
import { session } from './api.mjs';

const s = await session(process.env.OWNER_ID, process.env.OWNER_PW);
const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const { out, br, uid: U, item, dish } = ids;
const st = await s.get('/api/branches/structure');
const loc = (name) => st.locations.find((l) => l.name === name).id;

// Table bookings: online page on, deposits for big parties on weekends-style rule
for (const k of ['lounge', 'roof', 'mnr', 'cafe'])
  await s.put(`/api/reservations/outlets/${out[k]}/rules`, {
    online: k !== 'cafe', autoConfirm: k !== 'roof', slotMin: 30, fromMin: 12 * 60, toMin: 22 * 60 + 30, aheadDays: 30, maxOnline: 10,
    depositFrom: 10, depositPerHeadPaise: 50000, holdMin: 20, reminderHours: 3, cancelFreeHours: 6, noShowDeposit: 'KEEP', floorHoldMin: 30,
    durations: [{ upTo: 2, minutes: 90 }, { upTo: 6, minutes: 120 }, { upTo: 50, minutes: 150 }],
  });
console.log('booking rules ok');

// Hotel rules + plans
const modes = await s.get('/api/money/modes');
await s.put('/api/hotel/rules?branchId=' + br.vai, {
  online: true, checkInMin: 14 * 60, checkOutMin: 11 * 60, graceMin: 30, earlyFeePct: 50, lateFeePct: 50, lateFullMin: 18 * 60,
  formCHours: 24, roomTaxCode: 'ROOM',
  extras: [
    { key: 'laundry_shirt', name: 'Laundry – shirt', kind: 'LAUNDRY', price: 8000, taxCode: 'SERVICE' },
    { key: 'laundry_suit', name: 'Laundry – suit (dry clean)', kind: 'LAUNDRY', price: 45000, taxCode: 'SERVICE' },
    { key: 'airport', name: 'Airport drop (sedan)', kind: 'EXTRA', price: 90000, taxCode: 'SERVICE' },
    { key: 'extra_bed', name: 'Extra bed', kind: 'EXTRA', price: 100000, taxCode: 'ROOM' },
  ],
  minibar: [{ itemId: item['HK-MBW'], name: 'Mineral water 500 ml', price: 4000, taxCode: 'FOOD' }, { itemId: item['SFT-COK'], name: 'Coca-Cola', price: 9000, taxCode: 'FOOD' }],
  amenities: [{ itemId: item['HK-AMN'], name: 'Guest amenity kit', qty: 1 }],
  hkLocationId: loc('Housekeeping linen store'),
  hkChecklist: ['Bed made with fresh linen', 'Bathroom cleaned & sanitised', 'Amenity kit placed', 'Minibar checked & refilled', 'AC, TV, lights tested', 'Room fragrance'],
  requestSolverId: U.arjun, maintenanceSolverId: U.bhanwar, requestSlaMin: 20,
}).catch(async (e) => { console.log('hotel rules (query) failed, retry body', e.message.slice(0, 160)); });
const rooms = await s.get('/api/hosp/rooms');
const T = Object.fromEntries((rooms.types ?? []).map((t) => [t.code, t.id]));
const plans = await s.get('/api/hotel/plans?branchId=' + br.vai);
const havePlan = new Set((plans.plans ?? plans).map((p) => p.code));
const PLANS = [
  { code: 'BAR-EP', name: 'Best available – room only', meal: 'EP', rates: [['DLX', 380000, 420000], ['PRM', 520000, 580000], ['STE', 850000, 950000]] },
  { code: 'BAR-CP', name: 'Room + breakfast', meal: 'CP', rates: [['DLX', 430000, 470000], ['PRM', 580000, 640000], ['STE', 920000, 1020000]] },
];
for (const p of PLANS)
  if (!havePlan.has(p.code))
    await s.post('/api/hotel/plans', {
      branchId: br.vai, code: p.code, name: p.name, meal: p.meal, kind: 'RACK', weekendDays: [5, 6],
      rates: p.rates.map(([c, base, weekend]) => ({ roomTypeId: T[c], base, weekend, extraAdult: 80000, extraChild: 40000 })),
      seasons: [{ name: 'Christmas & New Year', from: '2026-12-20', to: '2027-01-05', pct: 25 }, { name: 'Wedding season', from: '2027-01-15', to: '2027-02-28', pct: 10 }],
      los: [{ nights: 3, pctOff: 5 }, { nights: 7, pctOff: 12 }],
      cancel: { freeHours: 48, charge: 'FIRST_NIGHT' }, noShow: 'FIRST_NIGHT',
    });
console.log('hotel plans ok');

// Banquets
const halls = await s.get('/api/banquets/halls');
const haveHall = new Set((halls.halls ?? halls).map((h) => h.name));
for (const h of [
  { branchId: br.vai, name: 'Tora Grand Ballroom', capacities: [{ style: 'Theatre', guests: 300 }, { style: 'Round tables', guests: 220 }, { style: 'Floating', guests: 400 }], rent: 7500000, rentTaxCode: 'SERVICE' },
  { branchId: br.vai, name: 'Terrace Lawn', capacities: [{ style: 'Floating', guests: 250 }, { style: 'Round tables', guests: 150 }], rent: 5000000, rentTaxCode: 'SERVICE' },
  { branchId: br.vai, name: 'Board Room', capacities: [{ style: 'Boardroom', guests: 20 }, { style: 'Theatre', guests: 35 }], rent: 1200000, rentTaxCode: 'SERVICE' },
  { branchId: br.mur, name: 'Rooftop private party (4th floor)', capacities: [{ style: 'Floating', guests: 120 }, { style: 'Seated', guests: 70 }], rent: 2500000, rentTaxCode: 'SERVICE' },
]) if (!haveHall.has(h.name)) await s.post('/api/banquets/halls', h);
const pk = ['Silver veg package', 'Gold veg package', 'Rooftop party package (2 mocktails)']; // created on first run
const per = (names, n = 0.15) => names.map((x) => ({ itemId: dish[x], name: x, perCover: n }));
for (const p of [
  { name: 'Silver veg package', pricePerPlate: 95000, taxCode: 'BANQUET', items: per(['Tora Paneer Tikka', 'Hara Bhara Kabab', 'Dal Makhani', 'Kadhai Paneer', 'Veg Dum Biryani', 'Butter Naan', 'Gulab Jamun (2 pc)']) },
  { name: 'Gold veg package', pricePerPlate: 125000, taxCode: 'BANQUET', items: per(['Tora Paneer Tikka', 'Mushroom Galouti', 'Crispy Corn Salt & Pepper', 'Dal Makhani', 'Paneer Butter Masala', 'Veg Dum Biryani', 'Garlic Naan', 'Penne Alfredo', 'Sizzling Brownie with Ice Cream']) },
  { name: 'Rooftop party package (2 mocktails)', pricePerPlate: 149900, taxCode: 'BANQUET', items: [...per(['Loaded Nachos', 'Chilli Paneer Dry', 'Peri Peri Fries', 'Farmhouse Pizza', 'Veg Hakka Noodles']), { itemId: dish['Virgin Mojito'], name: 'Virgin Mojito', perCover: 1 }, { itemId: dish['Watermelon Cooler'], name: 'Watermelon Cooler', perCover: 1 }] },
]) if (!pk.includes(p.name)) await s.post('/api/banquets/packages', p);
console.log('banquets ok');

// Bar + banquet branch rules (licence, dry days, event checklist)
const checklist = [
  { text: 'Hall set as per BEO layout', dept: 'Banquets' }, { text: 'Decor & stage ready, vendor signed off', dept: 'Banquets' },
  { text: 'Kitchen mise-en-place done for guaranteed covers', dept: 'Kitchen' }, { text: 'Sound & DJ tested', dept: 'Maintenance' },
  { text: 'Washrooms checked', dept: 'Housekeeping' }, { text: 'Valet team briefed', dept: 'Security' },
];
for (const b of ['mur', 'vai', 'mnr'])
  await s.put(`/api/hosp/branch-rules?branchId=${br[b]}`, {
    banquet: { advancePct: 30, cancelFreeDays: 15, checklist },
    bar: {
      licenceNo: b === 'mur' ? 'RJ/EXC/JPR/2025/0187' : b === 'mnr' ? 'RJ/EXC/JPR/2026/0412' : 'RJ/EXC/JPR/2026/0233',
      licensee: 'Tora Hospitality Pvt Ltd', liquorCategories: ['Liquor', 'Beer'], format: 'RAJASTHAN',
      dryDays: [{ date: '2027-01-26', reason: 'Republic Day' }, { date: '2027-01-30', reason: 'Martyrs’ Day' }, { date: '2026-11-24', reason: 'Guru Nanak Jayanti (demo)' }],
    },
  }).catch((e) => console.log('branch rules', b, e.message.slice(0, 200)));
console.log('branch rules ok');

// Compliance + temperature points
const haveC = new Set();
for (const b of Object.values(br)) { const c = await s.get('/api/compliance?branchId=' + b); for (const x of c.items ?? c) haveC.add(x.name); }
for (const c of [
  { branchId: br.mur, kind: 'FSSAI', name: 'FSSAI licence – Murlipura', number: '12226999000421', authority: 'FSSAI', expiresOn: '2027-05-31', remindDays: [60, 30, 7] },
  { branchId: br.mur, kind: 'LIQUOR', name: 'Bar licence – Murlipura', number: 'RJ/EXC/JPR/2025/0187', authority: 'Excise Dept, Rajasthan', expiresOn: '2027-03-31', remindDays: [60, 30, 7] },
  { branchId: br.mur, kind: 'FIRE_NOC', name: 'Fire NOC – Janak Square', number: 'JMC/FIRE/2026/3391', authority: 'Jaipur Municipal Corp.', expiresOn: '2026-12-05', remindDays: [30, 15, 7] },
  { branchId: br.mur, kind: 'MUSIC', name: 'Music licence (PPL/IPRS) – Sky Lounge', number: 'PPL/JPR/22891', expiresOn: '2026-11-30', remindDays: [30, 7] },
  { branchId: br.mur, kind: 'PEST_CONTROL', name: 'Pest control – monthly', expiresOn: '2026-11-20', everyDays: 30, remindDays: [3, 1] },
  { branchId: br.vai, kind: 'LIFT', name: 'Lift AMC & safety certificate', number: 'LIFT/VAI/0091', expiresOn: '2027-02-15', remindDays: [30, 7] },
  { branchId: br.ck, kind: 'FSSAI', name: 'FSSAI – Central kitchen', number: '12226999000588', expiresOn: '2027-08-31', remindDays: [60, 30] },
]) if (!haveC.has(c.name)) await s.post('/api/compliance', c);
const haveT = new Set();
for (const b of Object.values(br)) { const c = await s.get('/api/compliance/temps?branchId=' + b); for (const x of c.points ?? c) haveT.add(x.name); }
for (const t of [
  { branchId: br.mur, name: 'Walk-in cold room', unit: '°C', min: 0, max: 5 },
  { branchId: br.mur, name: 'Deep freezer', unit: '°C', min: -22, max: -15 },
  { branchId: br.mur, name: 'Bar chiller – Sky Bar', unit: '°C', min: 2, max: 8 },
  { branchId: br.ck, name: 'Central cold room', unit: '°C', min: 0, max: 5 },
]) if (!haveT.has(t.name)) await s.post('/api/compliance/temps', t);
console.log('compliance ok');
