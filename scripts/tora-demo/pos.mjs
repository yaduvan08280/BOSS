// Stage 9: a night at TORA Murlipura on the POS — orders, KOTs on the kitchen display, bills, splits, discounts, voids, payments.
import fs from 'node:fs';
import { as } from './people.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const { out, uid: U } = ids;
const owner = await as('owner');
const menu = await owner.get('/api/hosp/menu');
const M = Object.fromEntries(menu.items.map((i) => [i.name, i]));
const modes = await owner.get('/api/money/modes');
const mode = (n) => (modes.modes ?? modes).find((m) => m.name.startsWith(n)).id;
const tables = {};
for (const k of ['lounge', 'roof']) for (const f of await owner.get(`/api/hosp/outlets/${out[k]}/plan`)) for (const t of f.tables) tables[t.name] = t.id;

const stewards = { deepak: await as('deepak'), rahul: await as('rahul'), pooja: await as('pooja'), ankit: await as('ankit') };
const cashier = await as('manish');
const kitchen = await as('vinod');
const L = (name, qty = 1, variantKey, course) => ({ menuItemId: M[name].id, qty, ...(variantKey ? { variantKey } : {}), ...(course ? { course } : {}) });

async function order(stw, outlet, table, covers, items, more = {}) {
  const s = stewards[stw];
  const o = await s.post('/api/pos/orders', { outletId: out[outlet], type: table ? 'DINE_IN' : 'TAKEAWAY', ...(table ? { tableIds: [tables[table]] } : {}), covers, stewardId: U[stw], ...more });
  await s.post(`/api/pos/orders/${o.id}/items`, { items, fire: true });
  return o.id;
}
async function cookAll() {
  const kds = await kitchen.get(`/api/pos/outlets/${out.roof}/kds`).catch(() => null);
  return kds;
}
async function bill(orderId, opts = {}) {
  const c = await cashier.post(`/api/pos/orders/${orderId}/check`, opts);
  return c;
}
async function pay(check, parts, tip) {
  const total = Number(check.total ?? check.check?.total);
  const id = check.id ?? check.check?.id;
  let left = total;
  const payments = parts.map(([m, share, ref], i) => {
    const amt = i === parts.length - 1 ? left : Math.round(total * share);
    left -= amt;
    return { modeId: mode(m), amount: amt, ...(ref ? { reference: ref } : {}) };
  });
  return cashier.post(`/api/pos/checks/${id}/pay`, { payments, ...(tip ? { tip } : {}) });
}
const tryit = async (label, fn) => { try { return await fn(); } catch (e) { console.log(label, e.message.slice(0, 300)); } };

// Sky Lounge
const o1 = await tryit('L1', () => order('deepak', 'lounge', 'L1', 4, [L('Tora Paneer Tikka'), L('Crispy Corn Salt & Pepper'), L('Royal Stag', 2, '60_ml'), L('Kingfisher Premium 650 ml', 2), L('Dal Makhani', 1, 'full'), L('Butter Naan', 4)]));
const o2 = await tryit('L2', () => order('rahul', 'lounge', 'L2', 2, [L('Cosmopolitan'), L('Gin & Tonic'), L('Loaded Nachos')]));
const o3 = await tryit('L5', () => order('deepak', 'lounge', 'L5', 6, [L('Long Island Iced Tea', 2), L('Classic Mojito', 2), L('Virgin Mojito', 2), L('Chilli Paneer Dry'), L('Honey Chilli Potato'), L('Farmhouse Pizza')]));
await tryit('D1', () => order('rahul', 'lounge', 'D1', 6, [L('Budweiser 330 ml', 6), L('Peri Peri Fries', 2)]));
await tryit('S2', () => order('rahul', 'lounge', 'S2', 3, [L('Old Monk Cola', 3), L('Loaded Nachos')]));
// Rooftop
const o6 = await tryit('R1', () => order('pooja', 'roof', 'R1', 4, [L('Tora Sky Sunset', 2), L('Watermelon Cooler', 2), L('Tora Paneer Tikka'), L('Mushroom Galouti'), L('Paneer Butter Masala', 1, 'half'), L('Garlic Naan', 4), L('Sizzling Brownie with Ice Cream')]));
const o7 = await tryit('R3', () => order('ankit', 'roof', 'R3', 2, [L('Jameson', 2, '60_ml'), L('Cheese Garlic Bread')]));
const o8 = await tryit('G1', () => order('pooja', 'roof', 'G1', 8, [L('Tora Paneer Tikka', 2), L('Hara Bhara Kabab', 2), L('Margherita Pizza', 2), L('Veg Hakka Noodles', 2), L('Virgin Mojito', 4), L('Blue Lagoon (mocktail)', 4), L('Sizzling Brownie with Ice Cream', 2)], { note: 'Birthday – Neha turns 25. Candle on the brownie.' }));
const o9 = await tryit('R4', () => order('ankit', 'roof', 'R4', 4, [L('Kadhai Paneer'), L('Veg Dum Biryani'), L('Tandoori Roti', 6), L('Fresh Lime Soda', 4), L('Penne Alfredo')]));
const o10 = await tryit('R6', () => order('ankit', 'roof', 'R6', 2, [L('Absolut', 2, '60_ml'), L('Tandoori Soya Chaap')]));
await tryit('B1', () => order('ankit', 'roof', 'B1', 2, [L('Smirnoff', 2, '60_ml'), L('Peri Peri Fries')]));
const o12 = await tryit('TA', () => order('pooja', 'roof', null, 1, [L('Veg Dum Biryani'), L('Veg Fried Rice'), L('Gulab Jamun (2 pc)', 2)], { guestName: 'Swiggy-style phone order – Mr. Bansal' }));
console.log('orders placed');

// Kitchen display: mark tickets ready and bumped for the tables that are eating
const k1 = await tryit('kds', () => owner.get(`/api/pos/outlets/${out.lounge}/kds`));
const k2 = await tryit('kds', () => owner.get(`/api/pos/outlets/${out.roof}/kds`));
fs.writeFileSync(new URL('./kds-sample.json', import.meta.url), JSON.stringify({ k1, k2 }, null, 1).slice(0, 20000));

// R4: a wrong item punched — void the fired Penne Alfredo (not cooked)
if (o9) await tryit('void', async () => {
  const o = await owner.get(`/api/pos/orders/${o9}`);
  const it = (o.items ?? o.order?.items).find((x) => x.name?.includes('Alfredo') || x.menuItemId === M['Penne Alfredo'].id);
  await cashier.post(`/api/pos/orders/${o9}/items/${it.id}/void`, { reason: 'Wrong item punched', cooked: false });
});

// Bills + payments
if (o1) await tryit('pay1', async () => pay(await bill(o1), [['Cash', 1]]));
if (o2) await tryit('pay2', async () => pay(await bill(o2), [['UPI', 1, 'UPI 4011 2233 8812']]));
if (o3) await tryit('pay3', async () => pay(await bill(o3, { discount: { key: 'eazydiner', kind: 'PERCENT', value: 20, reason: 'EazyDiner PayEazy' } }), [['EazyDiner', 1, 'EZD-77812391']]));
if (o6) await tryit('pay6', async () => pay(await bill(o6), [['Card', 1, 'HDFC 4532']], { amount: 20000, stewardId: U.pooja }));
if (o7) await tryit('pay7', async () => pay(await bill(o7), [['UPI', 1, 'UPI 4019 5521 0093']]));
if (o8) await tryit('pay8', async () => {
  await cashier.post(`/api/pos/orders/${o8}/split`, { by: 'EQUAL', parts: 2 });
  const c = await bill(o8, { discount: { key: 'birthday', kind: 'AMOUNT', value: 32500, reason: 'Birthday – free dessert' } });
  return pay(c, [['UPI', 0.5, 'UPI 4022 1180 7771'], ['Card', 0.5, 'HDFC 9921']]);
});
if (o9) await tryit('pay9', async () => pay(await bill(o9), [['Cash', 1]]));
if (o12) await tryit('pay12', async () => pay(await bill(o12), [['UPI', 1, 'UPI 4031 0042 1113']]));
// R6: the steward asks 30% off — above their limit, it waits for the manager
if (o10) await tryit('disc', async () => stewards.ankit.post(`/api/pos/orders/${o10}/check`, { discount: { key: 'manager', kind: 'PERCENT', value: 30, reason: 'Regular guest – friend of the owner' } }));
console.log('bills done');
