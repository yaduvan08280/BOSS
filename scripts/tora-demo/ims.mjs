// Stage 2: tax rates, payment modes, stock items (kitchen, bar, hotel), dishes with recipes.
import fs from 'node:fs';
import { session } from './api.mjs';
import { ITEMS, MENU, LIQUOR_CATEGORIES } from './menu-data.mjs';

const s = await session(process.env.OWNER_ID, process.env.OWNER_PW);
const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));

// Tax rates — DEMO values (accountant to confirm). GST 2.0 (22/09/2025): restaurant 5 %, rooms ≤ ₹7,500 5 %, above 18 %.
const from = '2026-04-01';
for (const t of [
  { code: 'FOOD', name: 'GST on restaurant food & soft drinks', percent: 5, from },
  { code: 'LIQUOR', name: 'VAT on liquor (demo rate – confirm)', percent: 0, from },
  { code: 'ROOM', name: 'GST on rooms (by tariff slab)', percent: 5, from, slabs: [{ upTo: 750000, percent: 5 }, { upTo: 99999999900, percent: 18 }] },
  { code: 'BANQUET', name: 'GST on banquets & catering', percent: 5, from },
  { code: 'SERVICE', name: 'GST on other services (hall rent, decor)', percent: 18, from },
]) await s.put('/api/money/tax-rates', t);
console.log('tax ok');

// Payment modes
const modes = await s.get('/api/money/modes');
const have = new Set((modes.modes ?? modes).map((m) => m.name));
for (const m of [
  { name: 'Cash', kind: 'CASH' },
  { name: 'UPI (PhonePe / GPay)', kind: 'UPI', needsRef: true },
  { name: 'Card (HDFC POS)', kind: 'CARD', needsRef: true },
  { name: 'EazyDiner / District pay', kind: 'WALLET', needsRef: true },
  { name: 'Corporate credit', kind: 'COMPANY' },
  { name: 'Charge to room', kind: 'ROOM', branchId: ids.br.vai },
  { name: 'Bank transfer (NEFT)', kind: 'BANK', needsRef: true },
]) if (!have.has(m.name)) await s.post('/api/money/modes', m);
console.log('modes ok');

// Stock items
const existing = Object.fromEntries((await s.get('/api/ims/items')).items?.map((i) => [i.code, i.id]) ?? (await s.get('/api/ims/items')).map((i) => [i.code, i.id]));
const item = {};
for (const [code, name, unit, category, ratePaise, vendor, leadTimeDays, minQty, maxQty, kind] of ITEMS) {
  const body = { code, name, unit, category, ratePaise, vendor, leadTimeDays, minQty, maxQty, safetyFactor: 1.5 };
  item[code] = existing[code] ?? (await s.post('/api/ims/items', body)).id;
  if (kind === 'spirit')
    await s.put(`/api/ims/items/${item[code]}/extras`, {
      made: 'BUY', purchaseUnit: 'bottle', taxCode: 'LIQUOR', brand: name.split(' ')[0],
      units: [{ unit: 'bottle', factor: 750 }, { unit: 'case', factor: 9000 }, { unit: 'peg', factor: 60, serve: true }],
    });
  else if (kind === 'beer')
    await s.put(`/api/ims/items/${item[code]}/extras`, { made: 'BUY', purchaseUnit: 'case', taxCode: 'LIQUOR', units: [{ unit: 'case', factor: 12 }] });
  else if (unit === 'kg')
    await s.put(`/api/ims/items/${item[code]}/extras`, { made: 'BUY', units: [{ unit: 'g', factor: 0.001 }] });
}
console.log('items ok', Object.keys(item).length);

// Dishes + recipes
const dish = {};
let n = 0;
for (const [cat, rows] of MENU) {
  const liquor = rows.some(([, , lines]) => lines.some(([c]) => c.startsWith('LIQ') || c.startsWith('BER')));
  for (const [name, price, lines] of rows) {
    n++;
    const code = `DSH-${String(n).padStart(3, '0')}`;
    const isLiquor = lines.some(([c]) => c.startsWith('LIQ') || c.startsWith('BER'));
    dish[name] = existing[code] ?? (await s.post('/api/ims/items', { code, name, unit: liquor ? 'glass' : 'plate', category: cat })).id;
    await s.put(`/api/ims/items/${dish[name]}/extras`, {
      made: 'DISH', sellPrice: price * 100, taxCode: isLiquor ? 'LIQUOR' : 'FOOD', hsn: '996331',
    });
    await s.put('/api/ims/recipes', {
      itemId: dish[name], outputQty: 1,
      lines: lines.map(([c, qty]) => ({ itemId: item[c], qty, yieldPct: 100, wastagePct: c.startsWith('VEG') ? 5 : 0 })),
    });
  }
}
console.log('dishes ok', n, 'liquor cats', LIQUOR_CATEGORIES.join(','));
ids.item = item;
ids.dish = dish;
fs.writeFileSync(new URL('./ids.json', import.meta.url), JSON.stringify(ids, null, 1));
