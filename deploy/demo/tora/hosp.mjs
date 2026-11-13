import { dayIn } from './client.mjs';
import { BAR_CATEGORIES, MENU } from './data-kitchen.mjs';

const list = (x, key) => (Array.isArray(x) ? x : (x?.[key] ?? []));
const OUTLETS = [
  { key: 'sky', name: 'Tora Skylounge — Rooftop Bar & Restaurant', branch: 'sky', loc: 'Skylounge kitchen', kind: 'RESTAURANT', open: 11 * 60, close: 24 * 60, floors: [['Rooftop (4th floor)', 14], ['Lounge (3rd floor)', 8]], upi: 'toraskylounge@hdfcbank' },
  { key: 'vsn', name: 'Tora Skylounge Vaishali Nagar', branch: 'vsn', loc: 'Vaishali kitchen', kind: 'RESTAURANT', open: 12 * 60, close: 24 * 60, floors: [['Terrace', 12]], upi: 'toravaishali@hdfcbank' },
  { key: 'cafe', name: 'Aravali Café — Tora Suites', branch: 'sty', loc: 'Suites pantry', kind: 'CAFE', open: 7 * 60, close: 23 * 60, floors: [['Café', 6]], upi: 'torasuites@hdfcbank' },
];

/** Hospitality on; rules; three outlets with stations, ticket routes, floors and tables; the menu. */
export async function setup(ctx) {
  const { api, ids } = ctx;
  const p = (k) => ids.people[k].id;
  const roles = list(await api.get('/api/org/roles'), 'roles');
  const role = (key) => roles.find((r) => r.key === key)?.id;
  await api.put('/api/hosp/settings', {
    enabled: true,
    rules: {
      discounts: [
        { key: 'regular', name: 'Regular guest', kind: 'PERCENT' },
        { key: 'staff', name: 'Staff discount', kind: 'PERCENT', value: 20 },
        { key: 'happy', name: 'Happy hours (4–7 pm)', kind: 'PERCENT', value: 15 },
      ],
      limits: [
        { roleId: role('MEMBER'), maxPct: 5, voidPaise: 300_00 },
        { roleId: role('SUPERVISOR'), maxPct: 10, voidPaise: 1000_00 },
        { roleId: role('HOD'), maxPct: 25, nc: true, voidPaise: 10000_00 },
        { roleId: role('ADMIN'), maxPct: 100, nc: true, voidPaise: 100000_00 },
      ],
      approverIds: [p('vikram'), p('priya'), p('shalini'), p('arjun')],
      ncReasons: ['Owner’s guest', 'Staff meal', 'Complaint recovery', 'Food blogger'],
      dayClose: { cutoffMin: 4 * 60, closerIds: [p('vikram'), p('priya'), p('shalini'), p('neha')], blindCash: true },
    },
  });
  const outlets = list(await api.get('/api/hosp/outlets'), 'outlets');
  ids.outlets = {};
  ids.tables = {};
  for (const o of OUTLETS) {
    let row = outlets.find((x) => x.name === o.name);
    if (!row) {
      row = await api.post('/api/hosp/outlets', {
        name: o.name, kind: o.kind, branchId: ids.branches[o.branch], locationId: ids.locations[o.loc],
        openMin: o.open, closeMin: o.close,
        charges: { serviceChargePct: o.key === 'cafe' ? 0 : 10, packagingPaise: 20_00, deliveryPaise: 50_00, upiId: o.upi },
      });
      const st = {};
      for (const [name, kind] of [['Kitchen', 'KITCHEN'], ['Tandoor', 'TANDOOR'], ['Bar', 'BAR']])
        st[name] = (await api.post('/api/hosp/stations', { outletId: row.id, name, kind })).id;
      await api.put('/api/hosp/routes', {
        outletId: row.id,
        routes: [
          { category: '', stationId: st.Kitchen },
          { category: 'Tandoor & grills', stationId: st.Tandoor },
          ...BAR_CATEGORIES.map((category) => ({ category, stationId: st.Bar })),
        ],
      });
    }
    ids.outlets[o.key] = row.id;
    const floorsOf = async () => list(await api.get(`/api/hosp/outlets/${row.id}/plan`), 'floors');
    let floors = await floorsOf();
    for (const [i, [name, count]] of o.floors.entries()) {
      let floor = floors.find((f) => f.name === name);
      if (floor?.tables?.length) continue;
      floor ??= await api.post('/api/hosp/floors', { outletId: row.id, name });
      await api.post('/api/hosp/tables/bulk', { floorId: floor.id, count, prefix: i ? 'L' : 'T', seats: i ? 6 : 4 });
    }
    floors = await floorsOf();
    // The lounge tables and the last terrace tables can be joined for large parties.
    for (const f of floors)
      for (const t of f.tables ?? [])
        if (!t.combinable && (t.name.startsWith('L') || Number(t.name.slice(1)) >= 9))
          await api.put(`/api/hosp/tables/${t.id}`, { floorId: f.id, name: t.name, seats: t.seats, shape: t.shape, x: t.x, y: t.y, combinable: true }).catch(() => {});
    ids.tables[o.key] = floors.flatMap((f) => f.tables ?? []).map((t) => ({ id: t.id, name: t.name, seats: t.seats }));
  }
  // The menu (one for the company).
  const menu = await api.get('/api/hosp/menu');
  const cats = new Map(list(menu, 'categories').map((c) => [c.name, c.id]));
  const have = new Map(list(menu, 'items').map((i) => [i.name, i.id]));
  ids.menu = {};
  let made = 0;
  let addOns = list(menu, 'groups').find((g) => g.name === 'Add-ons');
  if (!addOns)
    addOns = await api.post('/api/hosp/menu/groups', {
      name: 'Add-ons', max: 2,
      options: [
        { key: 'cheese', name: 'Extra cheese', price: 60_00, itemId: ids.items['DRY-CHS'], qty: 0.03 },
        { key: 'butter', name: 'Extra butter', price: 30_00, itemId: ids.items['DRY-BUT'], qty: 0.015 },
      ],
    });
  for (const [i, [category, rows]] of Object.entries(MENU).entries()) {
    if (!cats.has(category)) cats.set(category, (await api.post('/api/hosp/menu/categories', { name: category, sort: i })).id);
    for (const [name, code, price, diet, tax] of rows) {
      if (!have.has(name)) {
        const body = {
          categoryId: cats.get(category), name, itemId: ids.items[code], price: price * 100, diet,
          taxCode: tax ?? 'FOOD', hsn: tax ? '996332' : '996331',
          ...(code === 'D-PTK' || code === 'D-CTK'
            ? { variants: [{ key: 'half', name: 'Half (4 pcs)', price: Math.round(price * 0.6) * 100, factor: 0.5 }, { key: 'full', name: 'Full (8 pcs)', price: price * 100 }] }
            : {}),
          ...(code === 'D-PIZ' || code === 'D-NAC' ? { modifierGroupIds: [addOns.id] } : {}),
        };
        have.set(name, (await api.post('/api/hosp/menu/items', body)).id);
        made += 1;
      }
      ids.menu[code] = have.get(name);
    }
  }
  return `3 outlets with kitchen, tandoor and bar stations, ${OUTLETS.flatMap((o) => o.floors).reduce((n, f) => n + f[1], 0)} tables; menu of ${have.size} items (${made} added)`;
}

const line = (ctx, code, qty = 1, more = {}) => ({ menuItemId: ctx.ids.menu[code], qty, ...more });

/** An evening's service at Murlipura and Vaishali Nagar: paid bills, a discount, a table still eating, a bill waiting. */
export async function service(ctx) {
  const { ids } = ctx;
  const M = ids.modes;
  const boss = await ctx.as('vikram');
  const floor = await boss.get(`/api/pos/outlets/${ids.outlets.sky}/floor`);
  const busy = JSON.stringify(floor).includes('"orderId":"') || (floor.orders?.length ?? 0) > 0;
  const day = await boss.get(`/api/pos/outlets/${ids.outlets.sky}/day`).catch(() => null);
  if (busy || (day?.report?.bills ?? day?.bills ?? 0) > 0) return 'already there';

  const serve = async (outlet, who, tableNo, covers, lines, how) => {
    const s = await ctx.as(who);
    const table = ids.tables[outlet][tableNo];
    const order = await s.post('/api/pos/orders', { outletId: ids.outlets[outlet], tableIds: [table.id], covers });
    await s.post(`/api/pos/orders/${order.id}/items`, { items: lines, fire: true });
    if (how.more) await s.post(`/api/pos/orders/${order.id}/items`, { items: how.more, fire: true });
    if (how.stop === 'eating') return order;
    const full = await s.get(`/api/pos/orders/${order.id}`);
    // The kitchen marks what it has cooked.
    if (how.ready !== false)
      for (const it of full.items ?? []) await s.post(`/api/pos/items/${it.id}/ready`, {}).catch(() => {});
    if (how.stop === 'served') return order;
    const check = await s.post(`/api/pos/orders/${order.id}/check`, how.bill ?? {});
    if (how.stop === 'billed' || check.pending) return order;
    const total = check.due ?? check.total;
    const parts = how.pay(total);
    await s.post(`/api/pos/checks/${check.id}/pay`, { payments: parts, ...(how.tip ? { tip: { amount: how.tip } } : {}) });
    return order;
  };
  const cash = (t) => [{ modeId: M.cash, amount: t }];
  const upi = (t) => [{ modeId: M.upi, amount: t, reference: `UPI${Math.floor(1e11 + Math.random() * 9e11)}` }];
  const card = (t) => [{ modeId: M.card, amount: t, reference: `VISA-${Math.floor(1000 + Math.random() * 9000)}` }];
  const half = (t) => [{ modeId: M.cash, amount: Math.floor(t / 200) * 100 }, { modeId: M.upi, amount: t - Math.floor(t / 200) * 100, reference: 'UPI884512067731' }];

  // Murlipura rooftop
  await serve('sky', 'sunil', 0, 2, [line(ctx, 'D-PTK', 1, { variantKey: 'full' }), line(ctx, 'D-GNT', 2), line(ctx, 'D-DAL'), line(ctx, 'D-NAN', 3)], { pay: upi, tip: 200_00 });
  await serve('sky', 'sunil', 1, 4, [line(ctx, 'D-CTK', 1, { variantKey: 'full' }), line(ctx, 'D-SKB'), line(ctx, 'D-OLD', 2), line(ctx, 'D-P-BER', 2), line(ctx, 'D-LAL'), line(ctx, 'D-BCH'), line(ctx, 'D-NAN', 6)], { pay: card });
  await serve('sky', 'manoj', 2, 2, [line(ctx, 'D-NAC'), line(ctx, 'D-CSM', 2), line(ctx, 'D-PIZ')], { bill: { discount: { kind: 'PERCENT', value: 10, reason: 'Regular guest' } }, pay: cash });
  await serve('sky', 'manoj', 3, 6, [line(ctx, 'D-PTK', 2, { variantKey: 'full' }), line(ctx, 'D-FSH', 2), line(ctx, 'D-LIT', 4), line(ctx, 'D-P-WHS', 4), line(ctx, 'D-BIR', 2), line(ctx, 'D-PBM', 2), line(ctx, 'D-ROT', 8), line(ctx, 'D-GJM', 3)], { pay: half, tip: 500_00 });
  await serve('sky', 'sunil', 4, 3, [line(ctx, 'D-MSH'), line(ctx, 'D-MOJ', 3), line(ctx, 'D-PIZ', 1)], { pay: upi });
  await serve('sky', 'sunil', 5, 2, [line(ctx, 'D-PRW'), line(ctx, 'D-P-WIN', 2), line(ctx, 'D-BCH'), line(ctx, 'D-NAN', 2)], { stop: 'billed' });
  await serve('sky', 'manoj', 6, 4, [line(ctx, 'D-DKB'), line(ctx, 'D-CTK', 1, { variantKey: 'half' }), line(ctx, 'D-MRG', 2), line(ctx, 'D-P-BER', 2)], { stop: 'eating', more: [line(ctx, 'D-LAL'), line(ctx, 'D-DAL'), line(ctx, 'D-NAN', 4)] });
  await serve('sky', 'sunil', 8, 2, [line(ctx, 'D-COF', 2), line(ctx, 'D-NAC')], { stop: 'served' });
  await serve('sky', 'manoj', 14, 8, [line(ctx, 'D-PTK', 2, { variantKey: 'full' }), line(ctx, 'D-SKB', 2), line(ctx, 'D-P-WHB', 8), line(ctx, 'D-P-BER', 6)], { stop: 'eating' });
  // Vaishali Nagar
  await serve('vsn', 'ritu', 0, 2, [line(ctx, 'D-PTK', 1, { variantKey: 'half' }), line(ctx, 'D-PBM'), line(ctx, 'D-NAN', 2), line(ctx, 'D-MOJ', 2)], { pay: upi });
  await serve('vsn', 'karan', 1, 5, [line(ctx, 'D-CTK', 1, { variantKey: 'full' }), line(ctx, 'D-FSH'), line(ctx, 'D-BCH', 2), line(ctx, 'D-BIR'), line(ctx, 'D-NAN', 6), line(ctx, 'D-P-BER', 4)], { pay: card, tip: 300_00 });
  await serve('vsn', 'ritu', 2, 2, [line(ctx, 'D-GNT', 2), line(ctx, 'D-NAC')], { stop: 'eating' });
  // The café at Tora Suites
  await serve('cafe', 'aman', 0, 2, [line(ctx, 'D-COF', 2), line(ctx, 'D-PIZ')], { pay: cash });
  return '13 orders tonight: 8 paid (cash, UPI, card, split, a 10 % discount, tips), 1 bill printed and waiting, 4 tables still eating with tickets in the kitchen';
}

const GUESTS = [
  ['Aarav Mehta', '9829011101', 2, 20 * 60, 0, 'Anniversary', 'Corner table with the Nahargarh view'],
  ['Ishita Singhania', '9829011102', 6, 20 * 60 + 30, 0, 'Birthday', 'Cake at 10 pm'],
  ['Kabir Bhandari', '9829011103', 4, 21 * 60, 0, null, null],
  ['Naina Rathore', '9829011104', 2, 19 * 60 + 30, 1, 'Date night', null],
  ['Dev Khanna', '9829011105', 10, 20 * 60, 1, 'Team dinner', 'Two vegetarian-only guests; one nut allergy'],
  ['Sara Fernandes', '9829011106', 3, 21 * 60 + 30, 1, null, null],
  ['Rhea Kothari', '9829011107', 4, 20 * 60, 2, 'Kitty party', null],
  ['Yash Poddar', '9829011108', 14, 20 * 60, 3, 'Farewell', 'Needs a microphone'],
];

export async function reservations(ctx) {
  const { api, ids } = ctx;
  const out = ids.outlets.sky;
  await api.put(`/api/reservations/outlets/${out}/rules`, { online: true, autoConfirm: true, slotMin: 30, maxOnline: 8, depositFrom: 10, depositPerHeadPaise: 500_00, fromMin: 11 * 60, toMin: 22 * 60 + 30 });
  await api.put(`/api/reservations/outlets/${ids.outlets.vsn}/rules`, { online: true, slotMin: 30, maxOnline: 6 });
  const guests = list(await api.get('/api/guests'), 'guests');
  if (guests.some((g) => g.name === GUESTS[0][0])) return 'already there';
  const host = await ctx.as('pooja');
  let made = 0;
  // Late in the evening "tonight" has gone: the first bookings are then for tomorrow.
  const late = new Date(Date.now() + 5.5 * 3600_000).getUTCHours() >= 17 ? 1 : 0;
  for (const [name, mobile, partySize, startMin, days, occasion, requests] of GUESTS) {
    const r = await host.tryPost('/api/reservations', {
      outletId: out, day: dayIn(days + late), startMin, partySize,
      guest: { name, mobile }, ...(occasion ? { occasion } : {}), ...(requests ? { requests } : {}),
    });
    if (!r.ok) {
      console.log(`    (booking for ${name} was refused: ${r.message})`);
      continue;
    }
    made += 1;
    // A large party pays its deposit at the desk, which confirms the booking.
    if (r.body.deposit?.state === 'DUE' && name === 'Dev Khanna')
      await host.post(`/api/reservations/${r.body.id}/deposit`, { modeId: ids.modes.upi, reference: 'UPI771204559810' });
  }
  for (const [name, mobile, partySize] of [['Tanya Bajaj', '9829011120', 4], ['Arnav Sethi', '9829011121', 2]])
    await host.tryPost('/api/reservations/waitlist', { outletId: out, partySize, name, mobile });
  const all = list(await api.get('/api/guests'), 'guests');
  const tag = async (name, body) => {
    const g = all.find((x) => x.name === name);
    if (g) await api.patch(`/api/guests/${g.id}`, body).catch(() => {});
  };
  await tag('Aarav Mehta', { tags: ['Regular', 'VIP'], notes: 'Prefers the corner table. Drinks single malt.' });
  await tag('Dev Khanna', { tags: ['Corporate'], allergies: 'One guest: tree nuts' });
  return `${made} table bookings over four days (one large party with a paid deposit), 2 parties on the waitlist; public booking page on`;
}
