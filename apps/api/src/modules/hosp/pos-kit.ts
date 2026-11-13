import type { PrismaClient } from '@mono/db';
import { group, ok } from '../branches/testkit';
import { entry, item, loc } from '../ims/stock-kit';
import type { world } from '../records/testkit';

export { ok };
export type World = Awaited<ReturnType<typeof world>>;
export type Api = World['api'];
export const post = <T = { id: string }>(api: Api, url: string, body: object = {}) =>
  ok<T>(api.post(url, body));

/**
 * A restaurant ready to serve: hospitality on, an outlet with a kitchen and a bar station (the bar has a printer),
 * a floor of six tables, GST 5 %, a menu with a recipe-backed dish, variants, an add-on, a drink, and stock in
 * the outlet's kitchen. Stewards may give 5 % and void up to ₹100 by themselves; a manager approves the rest.
 */
export async function restaurant(prisma: PrismaClient, w: World, printerAddress = '127.0.0.1:9') {
  const g = await group(w);
  await ok(
    w.api.put('/api/money/tax-rates', { code: 'GST5', name: 'GST 5%', percent: 5, from: '2020-01-01' }),
  );
  const kitchenLoc = await loc(w, g.b.rooftop.id, 'Rooftop kitchen', 'KITCHEN');
  const manager = await g.at('Meera Manager', g.b.rooftop.id, 'HOD');
  const steward = await g.at('Ravi Steward', g.b.rooftop.id, 'MEMBER');
  const steward2 = await g.at('Sana Steward', g.b.rooftop.id, 'MEMBER');
  await ok(
    w.api.put('/api/hosp/settings', {
      enabled: true,
      rules: {
        limits: [
          { roleId: w.role('MEMBER'), maxPct: 5, voidPaise: 100_00 },
          { roleId: w.role('HOD'), maxPct: 25, nc: true, voidPaise: 5000_00 },
        ],
        approverIds: [manager.id],
        ncReasons: ['Owner’s guest'],
        // The whole clock day is one business day in these tests.
        dayClose: { cutoffMin: 0, closerIds: [manager.id], blindCash: true },
      },
    }),
  );
  const printer = await post(w.api, '/api/hosp/printers', {
    name: 'Bar KOT',
    kind: 'KOT',
    address: printerAddress,
    branchId: g.b.rooftop.id,
  });
  const billPrinter = await post(w.api, '/api/hosp/printers', {
    name: 'Cash desk',
    kind: 'BILL',
    address: printerAddress,
    branchId: g.b.rooftop.id,
  });
  const outlet = await post(w.api, '/api/hosp/outlets', {
    name: 'Rooftop',
    branchId: g.b.rooftop.id,
    locationId: kitchenLoc,
    billPrinterId: billPrinter.id,
    charges: { serviceChargePct: 10, packagingPaise: 20_00, deliveryPaise: 50_00, upiId: 'rooftop@hdfc' },
  });
  const kitchen = await post(w.api, '/api/hosp/stations', { outletId: outlet.id, name: 'Kitchen' });
  const bar = await post(w.api, '/api/hosp/stations', {
    outletId: outlet.id,
    name: 'Bar',
    kind: 'BAR',
    printerId: printer.id,
  });
  await ok(
    w.api.put('/api/hosp/routes', {
      outletId: outlet.id,
      routes: [
        { category: '', stationId: kitchen.id },
        { category: 'Drinks', stationId: bar.id },
      ],
    }),
  );
  const floor = await post(w.api, '/api/hosp/floors', { outletId: outlet.id, name: 'Terrace' });
  await post(w.api, '/api/hosp/tables/bulk', { floorId: floor.id, count: 6 });
  const tables = await prisma.diningTable.findMany({
    where: { outletId: outlet.id },
    orderBy: { name: 'asc' },
  });
  const t = Object.fromEntries(tables.map((x) => [x.name, x.id])) as Record<string, string>;
  // Stock and recipes.
  const paneer = await item(w, { code: 'PAN', name: 'Paneer', unit: 'g' });
  const cheese = await item(w, { code: 'CHS', name: 'Cheese', unit: 'g' });
  const cola = await item(w, { code: 'COLA', name: 'Cola can' });
  const tikkaDish = await item(
    w,
    { code: 'D-TIK', name: 'Paneer tikka (dish)', unit: 'plate' },
    { made: 'DISH' },
  );
  await ok(w.api.put('/api/ims/recipes', { itemId: tikkaDish, lines: [{ itemId: paneer, qty: 200 }] }));
  await entry(w.api, { itemId: paneer, type: 'IN', qty: 5000, ratePaise: 40, locationId: kitchenLoc });
  await entry(w.api, { itemId: cheese, type: 'IN', qty: 500, ratePaise: 60, locationId: kitchenLoc });
  await entry(w.api, { itemId: cola, type: 'IN', qty: 48, ratePaise: 25_00, locationId: kitchenLoc });
  // The menu.
  const starters = await post(w.api, '/api/hosp/menu/categories', { name: 'Starters' });
  const mains = await post(w.api, '/api/hosp/menu/categories', { name: 'Mains', sort: 1 });
  const drinks = await post(w.api, '/api/hosp/menu/categories', { name: 'Drinks', sort: 2 });
  const addOns = await post(w.api, '/api/hosp/menu/groups', {
    name: 'Add-ons',
    max: 2,
    options: [{ key: 'cheese', name: 'Extra cheese', price: 40_00, itemId: cheese, qty: 20 }],
  });
  const menu = (body: object) =>
    post(w.api, '/api/hosp/menu/items', { taxCode: 'GST5', hsn: '996331', ...body });
  const tikka = await menu({
    categoryId: starters.id,
    name: 'Paneer tikka',
    itemId: tikkaDish,
    price: 320_00,
    variants: [
      { key: 'half', name: 'Half', price: 180_00, factor: 0.5 },
      { key: 'full', name: 'Full', price: 320_00 },
    ],
    modifierGroupIds: [addOns.id],
  });
  const dal = await menu({ categoryId: mains.id, name: 'Dal makhani', price: 280_00 });
  const naan = await menu({ categoryId: mains.id, name: 'Butter naan', price: 60_00 });
  const kulfi = await menu({ categoryId: mains.id, name: 'Kulfi', price: 120_00 });
  const colaItem = await menu({ categoryId: drinks.id, name: 'Cola', itemId: cola, price: 80_00 });
  const cash = await post(w.api, '/api/money/modes', { name: 'Cash', kind: 'CASH' });
  const upi = await post(w.api, '/api/money/modes', { name: 'UPI', kind: 'UPI', needsRef: true });
  const card = await post(w.api, '/api/money/modes', { name: 'Card', kind: 'CARD', needsRef: true });
  const room = await post(w.api, '/api/money/modes', { name: 'Room charge', kind: 'ROOM' });
  const company = await post(w.api, '/api/money/modes', { name: 'Company credit', kind: 'COMPANY' });
  return {
    g,
    outlet: outlet.id,
    kitchenLoc,
    stations: { kitchen: kitchen.id, bar: bar.id },
    t,
    stock: { paneer, cheese, cola },
    m: { tikka: tikka.id, dal: dal.id, naan: naan.id, kulfi: kulfi.id, cola: colaItem.id, addOns: addOns.id },
    modes: { cash: cash.id, upi: upi.id, card: card.id, room: room.id, company: company.id },
    manager,
    steward,
    steward2,
  };
}
export type Restaurant = Awaited<ReturnType<typeof restaurant>>;

export type OrderOut = {
  id: string;
  number: number;
  status: string;
  total: number;
  tableIds: string[];
  stewardId: string;
  items: {
    id: string;
    name: string;
    variantName: string | null;
    qty: number;
    price: number;
    status: string;
    checkNo: number;
    course: string | null;
    seat: number | null;
    voidAsked: boolean;
    stockNote: string | null;
    modifiers: { name: string }[];
  }[];
};
export type CheckOut = {
  pending: boolean;
  approvalId?: string;
  id: string;
  number: string;
  status: string;
  total: number;
  tax: number;
  taxable: number;
  roundOff: number;
  serviceCharge: number;
  discount: { amount: number } | null;
  parts: number[] | null;
  due: number;
  upi: string | null;
  payments: { mode: string; kind: string; amount: number; reference: string | null }[];
  orderStatus?: string;
};
export const open = (api: Api, r: Restaurant, table: string, more: object = {}) =>
  post<{ id: string; number: number }>(api, '/api/pos/orders', {
    outletId: r.outlet,
    tableIds: [r.t[table]],
    covers: 2,
    ...more,
  });
export const add = (api: Api, orderId: string, items: object[], fire = true) =>
  post<{
    added: number;
    skipped: number;
    kots: { id: string; number: number; stationId: string | null; items: number }[];
  }>(api, `/api/pos/orders/${orderId}/items`, { items, fire });
export const order = (api: Api, id: string) => ok<OrderOut>(api.get(`/api/pos/orders/${id}`));
export const bill = (api: Api, orderId: string, body: object = {}) =>
  post<CheckOut>(api, `/api/pos/orders/${orderId}/check`, body);
export const pay = (api: Api, checkId: string, payments: object[], tip?: object) =>
  post<CheckOut>(api, `/api/pos/checks/${checkId}/pay`, { payments, ...(tip ? { tip } : {}) });
