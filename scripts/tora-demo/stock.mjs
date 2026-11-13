// Stage 8: stock — goods receipts at the central store and outlets, a transfer CK → Murlipura, par levels, a PO.
import fs from 'node:fs';
import { as, dayStr } from './people.mjs';
import { ITEMS } from './menu-data.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const owner = await as('owner');
const st = await owner.get('/api/branches/structure');
const loc = (name) => st.locations.find((l) => l.name === name).id;
const I = ids.item;
const meta = Object.fromEntries(ITEMS.map((r) => [r[0], r]));
const mid = (code, f = 0.7) => { const [, , unit, , , , , min, max] = meta[code]; const q = min + (max - min) * f; return unit === 'ml' ? Math.round(q / 750) * 750 : Math.round(q * 10) / 10; };
const lines = (codes, f) => codes.map((c) => ({ itemId: I[c], qty: mid(c, f), ratePaise: meta[c][4] }));
const by = (pred) => ITEMS.filter(pred).map((r) => r[0]);

const done = (await owner.get('/api/ims/grn')).receipts ?? (await owner.get('/api/ims/grn'));
const seen = new Set(done.map((g) => g.invoiceNo));

const gopal = await as('gopal'), vinod = await as('vinod'), neha = await as('neha'), karan = await as('karan');
// Central store: dry, frozen, bakery, packaging, cleaning; liquor bond: spirits + beer + mixers
await gopal.post('/api/ims/grn', { vendor: 'Agarwal Kirana Wholesale', locationId: loc('Central dry store'), invoiceNo: 'AKW/2611/3381', invoiceDate: dayStr(-2), lines: lines(by((r) => /Dry grocery|Spices|Frozen/.test(r[3])), 0.9) });
await gopal.post('/api/ims/grn', { vendor: 'Le Pain Bakers', locationId: loc('Central cold room'), invoiceNo: 'LPB-0917', invoiceDate: dayStr(-1), lines: lines(by((r) => r[3] === 'Bakery'), 0.8) });
await gopal.post('/api/ims/grn', { vendor: 'Jaipur Packaging House', locationId: loc('Central dry store'), invoiceNo: 'JPH/552', invoiceDate: dayStr(-3), lines: lines(by((r) => /Packaging|Cleaning/.test(r[3])), 0.8) });
await gopal.post('/api/ims/grn', { vendor: 'RSBCL depot – Jaipur', locationId: loc('Central liquor bond'), invoiceNo: 'RSBCL/JPR/88213', invoiceDate: dayStr(-2), lines: lines(by((r) => /Liquor|Beer/.test(r[3])), 0.95) });
await gopal.post('/api/ims/grn', { vendor: 'Pink City Beverages', locationId: loc('Central dry store'), invoiceNo: 'PCB/4471', invoiceDate: dayStr(-2), lines: lines(by((r) => r[3] === 'Soft drinks'), 0.9) });
// Murlipura buys vegetables and dairy fresh every morning
await vinod.post('/api/ims/grn', { vendor: 'Shree Shyam Sabzi Suppliers (Muhana Mandi)', locationId: loc('Murlipura kitchen store'), invoiceNo: 'SSS-1311', invoiceDate: dayStr(0), lines: lines(by((r) => r[3] === 'Vegetables'), 0.7) });
await vinod.post('/api/ims/grn', { vendor: 'Krishna Dairy Products', locationId: loc('Murlipura kitchen store'), invoiceNo: 'KDP/7781', invoiceDate: dayStr(0), lines: lines(by((r) => r[3] === 'Dairy'), 0.7), note: 'Paneer & cream checked at 4 °C' });
// Hotel: linen + amenities
await (await as('kavita')).post('/api/ims/grn', { vendor: 'Rajasthan Linen Co.', locationId: loc('Housekeeping linen store'), invoiceNo: 'RLC/221', invoiceDate: dayStr(-5), lines: lines(by((r) => /Linen|Amenities/.test(r[3])), 0.8) });
console.log('receipts ok');

// Transfer central → Murlipura (asked by the outlet, approved + dispatched by the central store, received by the outlet)
const toMur = [...by((r) => /Dry grocery|Spices|Frozen|Bakery|Soft drinks|Packaging|Cleaning/.test(r[3])).map((c) => ({ itemId: I[c], qty: mid(c, 0.45) })),
  ...by((r) => /Liquor|Beer/.test(r[3])).map((c) => ({ itemId: I[c], qty: mid(c, 0.5) }))];
const t = await karan.post('/api/ims/transfers', { kind: 'INDENT', fromLocationId: loc('Central dry store'), toLocationId: loc('Murlipura kitchen store'), lines: toMur.filter((l) => !/LIQ|BER/.test(Object.keys(I).find((k) => I[k] === l.itemId))), note: 'Weekly indent – dry store' }).catch((e) => console.log('transfer', e.message.slice(0, 300)));
const t2 = await karan.post('/api/ims/transfers', { kind: 'INDENT', fromLocationId: loc('Central liquor bond'), toLocationId: loc('Murlipura kitchen store'), lines: toMur.filter((l) => /LIQ|BER/.test(Object.keys(I).find((k) => I[k] === l.itemId))), note: 'Weekly liquor indent (excise permit attached)' }).catch((e) => console.log('transfer2', e.message.slice(0, 300)));
for (const tr of [t, t2].filter(Boolean)) {
  const id = tr.id ?? tr.transfer?.id;
  for (const [who, a, body] of [[gopal, 'approve', {}], [gopal, 'dispatch', {}], [karan, 'receive', { lines: [] }]]) {
    await who.post(`/api/ims/transfers/${id}/${a}`, body).catch((e) => console.log(a, e.message.slice(0, 300)));
  }
}
console.log('transfers done');

// Par levels at Murlipura
await owner.put('/api/ims/par', { locationId: loc('Murlipura kitchen store'), levels: ['DAI-PAN', 'DAI-CRM', 'VEG-ONI', 'VEG-TOM', 'LIQ-RST', 'LIQ-SMI', 'LIQ-BAC', 'BER-KFP', 'SFT-SOD'].map((c) => ({ itemId: I[c], par: mid(c, 0.6), min: meta[c][7] })) }).catch((e) => console.log('par', e.message.slice(0, 200)));
// A purchase order waiting for delivery
const nitin = await as('nitin');
await nitin.post('/api/ims/po', { vendor: 'RSBCL depot – Jaipur', expectedOn: dayStr(2), locationId: loc('Central liquor bond'), note: 'For the Infosys rooftop night', lines: [{ itemId: I['LIQ-BSG'], qty: 4500, ratePaise: 400 }, { itemId: I['LIQ-JAM'], qty: 2250, ratePaise: 440 }, { itemId: I['BER-KFP'], qty: 96, ratePaise: 15000 }] }).catch((e) => console.log('po', e.message.slice(0, 200)));
console.log('stock ok');
