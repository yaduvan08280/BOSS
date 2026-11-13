import { dayIn } from './client.mjs';
import { DISHES, ITEMS, OUTLET_SHARE } from './data-kitchen.mjs';

const paise = (rupees) => Math.round(rupees * 100);
const byName = (rows, name) => rows.find((r) => r.name?.toLowerCase() === name.toLowerCase());

/** Tax rates (to be confirmed by the accountant), payment modes, and the hospitality pack with its roles. */
export async function money(ctx) {
  const { api, ids } = ctx;
  const packs = await api.get('/api/packs');
  const installed = (packs.installed ?? packs.packs ?? []).some((p) => p.key === 'hospitality' && !p.removedAt);
  if (!installed) await api.post('/api/packs/library/hospitality', {});
  const rate = (code, name, percent, slabs) =>
    api.put('/api/money/tax-rates', { code, name, percent, from: '2025-04-01', ...(slabs ? { slabs } : {}) });
  await rate('FOOD', 'GST on food', 5);
  await rate('LIQUOR', 'Liquor (price includes state VAT)', 0);
  await rate('ROOM', 'GST on rooms (by tariff slab)', 12, [{ upTo: 7500_00, percent: 12 }, { upTo: null, percent: 18 }]);
  await rate('BANQUET', 'GST on banquets', 18);
  await rate('SERVICE', 'GST on other services', 18);
  const modes = await api.get('/api/money/modes');
  const have = modes.modes ?? modes;
  ids.modes = {};
  for (const [key, name, kind, needsRef] of [
    ['cash', 'Cash', 'CASH', false], ['upi', 'UPI', 'UPI', true], ['card', 'Card', 'CARD', true],
    ['room', 'Room charge', 'ROOM', false], ['company', 'Company credit', 'COMPANY', false],
  ]) {
    const row = have.find((m) => m.kind === kind && !m.branchId) ?? byName(have, name) ?? (await api.post('/api/money/modes', { name, kind, needsRef }));
    ids.modes[key] = row.id;
  }
  return 'hospitality pack installed; tax codes FOOD 5 %, ROOM 12 / 18 %, BANQUET 18 %, LIQUOR 0 % (accountant to confirm); 5 payment modes';
}

export async function items(ctx) {
  const { api, ids } = ctx;
  const all = await api.get('/api/ims/items');
  const have = new Map((all.items ?? all).map((i) => [i.code, i]));
  ids.items = {};
  let made = 0;
  for (const [code, name, unit, category, rate, vendor, , units] of ITEMS) {
    let row = have.get(code);
    if (!row) {
      row = await api.post('/api/ims/items', { code, name, unit, category, ratePaise: paise(rate), vendor, leadTimeDays: category === 'Liquor' ? 5 : 2 });
      if (units) await api.put(`/api/ims/items/${row.id}/extras`, { units });
      made += 1;
    }
    ids.items[code] = row.id;
  }
  for (const [code, name, lines] of DISHES) {
    let row = have.get(code);
    if (!row) {
      row = await api.post('/api/ims/items', { code, name, unit: 'plate', category: 'Dishes' });
      await api.put(`/api/ims/items/${row.id}/extras`, { made: 'DISH' });
      await api.put('/api/ims/recipes', { itemId: row.id, lines: lines.map(([c, qty]) => ({ itemId: ids.items[c], qty })) });
      made += 1;
    }
    ids.items[code] = row.id;
  }
  return `${made} added — ${ITEMS.length} stock items and ${DISHES.length} dishes with recipes`;
}

export async function stock(ctx) {
  const { api, ids } = ctx;
  const L = ids.locations;
  const reg = await api.get('/api/ims/moves').catch(() => ({ moves: [] }));
  if ((reg.moves ?? reg.rows ?? reg).length > 5) return 'already there';
  const enter = (code, qty, locationId, rate) =>
    api.post('/api/ims/stock/entry', { itemId: ids.items[code], type: 'IN', qty, ratePaise: paise(rate), locationId, note: 'Opening stock' });
  for (const [code, , , category, rate, , qty] of ITEMS) {
    if (category === 'Housekeeping') {
      await enter(code, qty, L['Housekeeping store'], rate);
      continue;
    }
    await enter(code, qty, L['Central store'], rate);
    for (const [place, share] of Object.entries(OUTLET_SHARE)) {
      if (category === 'Liquor' && place === 'Suites pantry') continue;
      const q = category === 'Liquor' && code !== 'LIQ-BER' ? Math.max(750, Math.round((qty * share) / 750) * 750) : Math.max(1, Math.round(qty * share));
      await enter(code, q, L[place], rate);
    }
  }
  // The central kitchen supplies the outlets.
  for (const bk of ['sky', 'vsn', 'sty'])
    await api.put('/api/ims/routes', { toBranchId: ids.branches[bk], fromLocationId: L['Central store'] });

  // A purchase order to the dairy, received with one can rejected.
  const po = await api.post('/api/ims/po', {
    vendor: 'Saras Dairy Distributors', locationId: L['Central store'],
    lines: [{ itemId: ids.items['DRY-PAN'], qty: 40, ratePaise: 340_00 }, { itemId: ids.items['DRY-CRM'], qty: 30, ratePaise: 210_00 }],
  });
  await api.post(`/api/ims/po/${po.id}/send`, {});
  await api.post('/api/ims/grn', {
    poId: po.id, invoiceNo: 'SDD/2611/418', invoiceDate: dayIn(0),
    lines: [
      { itemId: ids.items['DRY-PAN'], qty: 40, ratePaise: 340_00 },
      { itemId: ids.items['DRY-CRM'], qty: 30, ratePaise: 214_00, rejected: 2, rejectReason: 'Two packs leaking' },
    ],
  });
  // A second order still open with the vendor.
  const po2 = await api.post('/api/ims/po', {
    vendor: 'Royal Poultry & Meats', locationId: L['Central store'],
    lines: [{ itemId: ids.items['MEA-CHK'], qty: 50, ratePaise: 318_00 }, { itemId: ids.items['MEA-MUT'], qty: 20, ratePaise: 780_00 }],
  });
  await api.post(`/api/ims/po/${po2.id}/send`, {});

  // The C-Scheme outlet asks the central kitchen for stock; it is dispatched and received.
  const vikram = await ctx.as('vikram');
  const ask = await vikram.post('/api/ims/transfers', {
    toLocationId: L['Skylounge kitchen'],
    lines: [{ itemId: ids.items['DRY-PAN'], qty: 10 }, { itemId: ids.items['MEA-CHK'], qty: 12 }, { itemId: ids.items['LIQ-GIN'], qty: 3, unit: 'bottle' }],
  });
  const tr = ask.id ?? ask.transfer?.id;
  await api.post(`/api/ims/transfers/${tr}/dispatch`, {}).catch(async () => {
    await api.post(`/api/ims/transfers/${tr}/approve`, {});
    await api.post(`/api/ims/transfers/${tr}/dispatch`, {});
  });
  await vikram.post(`/api/ims/transfers/${tr}/receive`, {});
  // Vaishali Nagar has asked too — waiting at the central kitchen.
  await (await ctx.as('priya')).post('/api/ims/transfers', {
    toLocationId: L['Vaishali kitchen'],
    lines: [{ itemId: ids.items['VEG-TOM'], qty: 15 }, { itemId: ids.items['GRO-RIC'], qty: 25 }, { itemId: ids.items['LIQ-VOD'], qty: 4, unit: 'bottle' }],
  });
  // Wastage and breakage.
  await api.post('/api/ims/wastage', { itemId: ids.items['VEG-MNT'], locationId: L['Skylounge kitchen'], qty: 1.5, reason: 'SPOILED', note: 'Wilted over the weekend' });
  await api.post('/api/ims/wastage', { itemId: ids.items['LIQ-WHS'], locationId: L['Skylounge kitchen'], qty: 750, reason: 'BREAKAGE', note: 'Bottle slipped during stock take' }).catch(() => {});
  return 'opening stock at the central store and every outlet; 2 purchase orders (one received), 2 transfers, wastage';
}
