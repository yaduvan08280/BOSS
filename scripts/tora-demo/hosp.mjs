// Stage 3: outlets, stations, KOT routing, floors + tables, menu, POS rules, hotel rooms.
import fs from 'node:fs';
import { session } from './api.mjs';
import { MENU } from './menu-data.mjs';

const s = await session(process.env.OWNER_ID, process.env.OWNER_PW);
const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const st = await s.get('/api/branches/structure');
const loc = (name) => st.locations.find((l) => l.name === name).id;
const U = ids.uid;

// Outlets
const OUTLETS = [
  { key: 'lounge', name: 'Sky Lounge – 3rd floor', kind: 'BAR', branch: 'mur', location: 'Murlipura kitchen store', open: 11 * 60, close: 23 * 60 + 30, sc: 5 },
  { key: 'roof', name: 'Rooftop – 4th floor', kind: 'RESTAURANT', branch: 'mur', location: 'Murlipura kitchen store', open: 11 * 60, close: 23 * 60 + 30, sc: 5 },
  { key: 'cafe', name: 'Tora Café – Vaishali', kind: 'CAFE', branch: 'vai', location: 'Café bar', open: 7 * 60, close: 23 * 60, sc: 0 },
  { key: 'ird', name: 'In-room dining – Vaishali', kind: 'ROOM_SERVICE', branch: 'vai', location: 'Hotel store', open: 0, close: 1439, sc: 0 },
  { key: 'mnr', name: 'Malviya Nagar Rooftop', kind: 'RESTAURANT', branch: 'mnr', location: 'Malviya Nagar store', open: 12 * 60, close: 23 * 60 + 30, sc: 5 },
];
let outlets = await s.get('/api/hosp/outlets');
const out = {};
for (const o of OUTLETS) {
  const found = outlets.find((x) => x.name === o.name);
  const body = {
    name: o.name, kind: o.kind, branchId: ids.br[o.branch], locationId: loc(o.location), openMin: o.open, closeMin: o.close,
    charges: { serviceChargePct: o.sc, packagingPaise: 2000, deliveryPaise: 4000, roundTo: 1, upiId: 'toraskylounge@hdfcbank' },
  };
  out[o.key] = found ? (await s.put(`/api/hosp/outlets/${found.id}`, body), found.id) : (await s.post('/api/hosp/outlets', body)).id;
}
console.log('outlets ok');

// Stations + routes
const STATIONS = {
  lounge: [['Main kitchen', 'KITCHEN'], ['Tandoor', 'TANDOOR'], ['Sky Bar', 'BAR'], ['Desserts', 'DESSERT']],
  roof: [['Main kitchen', 'KITCHEN'], ['Tandoor', 'TANDOOR'], ['Rooftop Bar', 'BAR'], ['Desserts', 'DESSERT']],
  cafe: [['Café kitchen', 'KITCHEN'], ['Café bar', 'BAR']],
  ird: [['Hotel kitchen', 'KITCHEN']],
  mnr: [['Kitchen', 'KITCHEN'], ['Bar', 'BAR']],
};
const ROUTE = (stations, cat, name) => {
  const by = (k) => stations.find(([, kind, , n]) => kind === k)?.[2];
  if (/Spirits|cocktails|Beer|Mocktails/.test(cat)) return by('BAR');
  if (cat === 'Breads & rice' && by('TANDOOR')) return by('TANDOOR');
  if (/Noodles|Fried Rice|Chilli|Honey|Crispy Corn/.test(name ?? '') && stations.find((x) => x[0] === 'Chinese wok')) return stations.find((x) => x[0] === 'Chinese wok')[2];
  if (cat === 'Desserts' && by('DESSERT')) return by('DESSERT');
  return null;
};
for (const [k, list] of Object.entries(STATIONS)) {
  const plan = await s.get(`/api/hosp/outlets/${out[k]}/plan`);
  const have = plan.stations ?? [];
  const rows = [];
  for (const [name, kind] of list) {
    const f = have.find((x) => x.name === name);
    rows.push([name, kind, f ? f.id : (await s.post('/api/hosp/stations', { outletId: out[k], name, kind, display: true })).id]);
  }
  const routes = [{ category: '', stationId: rows[0][2] }];
  for (const [cat] of MENU) { const sid = ROUTE(rows, cat); if (sid) routes.push({ category: cat, stationId: sid }); }
  await s.put('/api/hosp/routes', { outletId: out[k], routes });
}
console.log('stations ok');

// Floors + tables
const FLOORS = [
  ['lounge', '3rd floor – Lounge', [['Lounge', 'L', 10, 4, ['deepak', 'rahul']], ['Dance floor side', 'D', 4, 6, ['vishal']], ['Smoking area', 'S', 3, 4, ['vishal']]]],
  ['roof', '4th floor – Rooftop', [['Skyline view', 'R', 8, 4, ['pooja', 'ankit']], ['Gazebo', 'G', 4, 8, ['sonu']], ['Bar counter', 'B', 4, 2, ['ankit']]]],
  ['cafe', 'Café', [['Café', 'C', 8, 4, []]]],
  ['mnr', 'Rooftop', [['Rooftop', 'M', 10, 4, []]]],
];
for (const [k, floorName, sections] of FLOORS) {
  let plan = await s.get(`/api/hosp/outlets/${out[k]}/plan`);
  let floor = plan.floors?.find((f) => f.name === floorName);
  if (!floor) floor = await s.post('/api/hosp/floors', { outletId: out[k], name: floorName });
  plan = await s.get(`/api/hosp/outlets/${out[k]}/plan`);
  const tables = new Set((plan.tables ?? []).map((t) => t.name));
  let i = 0;
  for (const [section, prefix, count, seats, stewards] of sections) {
    for (let n = 1; n <= count; n++, i++) {
      const name = `${prefix}${n}`;
      if (tables.has(name)) continue;
      await s.post('/api/hosp/tables', {
        floorId: floor.id, name, seats, section, shape: seats >= 6 ? 'RECT' : seats === 2 ? 'ROUND' : 'SQUARE',
        x: (i % 6) * 4, y: Math.floor(i / 6) * 4, combinable: seats <= 4, stewardIds: stewards.map((x) => U[x]).filter(Boolean),
      });
    }
  }
}
console.log('tables ok');

// Menu
const menu = await s.get('/api/hosp/menu');
const cats = Object.fromEntries((menu.categories ?? []).map((c) => [c.name, c.id]));
const items = new Set((menu.items ?? []).map((i) => i.name));
const HINDI = { 'Sky Bites (starters)': 'स्टार्टर्स', Mains: 'मेन कोर्स', 'Breads & rice': 'रोटी और चावल', Desserts: 'मिठाई', 'Mocktails & soft drinks': 'मॉकटेल', 'Signature cocktails': 'कॉकटेल', 'Spirits (60 ml)': 'स्पिरिट्स', Beer: 'बीयर' };
let sort = 0;
for (const [cat, rows] of MENU) {
  if (!cats[cat]) cats[cat] = (await s.post('/api/hosp/menu/categories', { name: cat, nameHi: HINDI[cat], sort: sort })).id;
  sort++;
  const isBar = /Spirits|cocktails|Beer/.test(cat);
  for (const [name, price, , variants] of rows) {
    if (items.has(name)) continue;
    await s.post('/api/hosp/menu/items', {
      categoryId: cats[cat], name, itemId: ids.dish[name], diet: 'VEG', price: price * 100, hsn: '996331',
      taxCode: isBar ? 'LIQUOR' : 'FOOD', spice: /Chilli|Peri|Arrabbiata/.test(name) ? 2 : 0,
      allergens: /Paneer|Cheese|Alfredo|Pizza|Makhani|Butter|Jamun|Brownie|Galouti/.test(name) ? ['Dairy'] : [],
      variants: (variants ?? []).map(([v, p, factor]) => ({ key: v.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: v, price: p * 100, factor })),
      // Liquor only where the bar licence is: Murlipura + Malviya Nagar.
      ...(isBar ? { outletIds: [out.lounge, out.roof, out.mnr] } : {}),
    });
  }
}
console.log('menu ok');

// POS rules: discounts, role limits, approvers, day close
const roles = ids.roles;
await s.put('/api/hosp/settings', {
  rules: {
    discounts: [
      { key: 'happy_hours', name: 'Happy hours 1+1 (bar, 4–7 pm)', kind: 'PERCENT', on: 'ITEM', value: 50 },
      { key: 'eazydiner', name: 'EazyDiner / District offer', kind: 'PERCENT', on: 'BILL', value: 20 },
      { key: 'regular', name: 'Regular guest', kind: 'PERCENT', on: 'BILL', value: 10 },
      { key: 'birthday', name: 'Birthday – free dessert', kind: 'AMOUNT', on: 'ITEM', value: 32500 },
      { key: 'manager', name: 'Manager discretion', kind: 'PERCENT', on: 'BILL' },
    ],
    limits: [
      { roleId: roles['Steward / captain'], maxPct: 0, maxPaise: 0, nc: false, voidPaise: 0 },
      { roleId: roles['Cashier'], maxPct: 10, maxPaise: 50000, nc: false, voidPaise: 30000 },
      { roleId: roles['F&B manager'], maxPct: 25, maxPaise: 300000, nc: true, voidPaise: 200000 },
      { roleId: roles['General manager'], maxPct: 50, maxPaise: 1000000, nc: true, voidPaise: 1000000 },
    ],
    approverIds: [U.karan, U.rohan],
    ncReasons: ['Owner’s guest', 'Staff meal', 'Complaint recovery', 'Influencer visit (marketing)'],
    dayClose: { cutoffMin: 240, closerIds: [U.manish, U.karan], denominations: [500, 200, 100, 50, 20, 10, 5, 2, 1], blindCash: true },
  },
});
console.log('rules ok');

// Hotel rooms at Vaishali
const rooms = await s.get('/api/hosp/rooms');
const types = rooms.types ?? [];
const TYPES = [
  ['Deluxe Room', 'DLX', 2, 3, '1 queen', ['AC', 'Wi-Fi', 'Smart TV', 'Tea/coffee maker'], 380000, 101, 110, '1'],
  ['Premier Room', 'PRM', 2, 3, '1 king', ['AC', 'Wi-Fi', 'Smart TV', 'Minibar', 'Bathtub'], 520000, 201, 206, '2'],
  ['Tora Suite', 'STE', 2, 4, '1 king + sofa bed', ['AC', 'Wi-Fi', 'Living room', 'Minibar', 'City view', 'Bathtub'], 850000, 301, 302, '3'],
];
for (const [name, code, occupancy, maxOccupancy, beds, amenities, tariff, from, to, floor] of TYPES) {
  let t = types.find((x) => x.code === code);
  if (!t) t = await s.post('/api/hosp/room-types', { branchId: ids.br.vai, name, code, occupancy, maxOccupancy, beds, amenities, tariff, taxCode: 'ROOM' });
  if (!(rooms.rooms ?? []).some((r) => r.typeId === t.id)) await s.post('/api/hosp/rooms/bulk', { typeId: t.id, from, to, floor });
}
console.log('rooms ok');
ids.out = out;
fs.writeFileSync(new URL('./ids.json', import.meta.url), JSON.stringify(ids, null, 1));
