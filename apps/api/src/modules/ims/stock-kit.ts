import type { PrismaClient } from '@mono/db';
import { group, ok, type World } from '../branches/testkit';

export { ok };
export type { World };
export const today = (plus = 0) =>
  new Date(Date.now() + plus * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** An item with its phase-13 settings (tracking, units, second unit …). */
export async function item(w: World, body: Record<string, unknown>, extras?: Record<string, unknown>) {
  const i = await ok<{ id: string }>(w.api.post('/api/ims/items', { unit: 'pcs', ...body }));
  if (extras) await ok(w.api.put(`/api/ims/items/${i.id}/extras`, extras));
  return i.id;
}
export const loc = (w: World, branchId: string, name: string, kind = 'STORE') =>
  ok<{ id: string }>(w.api.post('/api/branches/locations', { branchId, name, kind })).then((l) => l.id);
export const entry = (api: World['api'], body: Record<string, unknown>) =>
  ok<{ moveIds: string[]; stock: number; batchIds: string[]; picks: { batchId: string; qty: number }[] }>(
    api.post('/api/ims/stock/entry', body),
  );
/** What a location holds of an item (all batches). */
export async function at(prisma: PrismaClient, itemId: string, locationId: string) {
  const rows = await prisma.stockBalance.findMany({ where: { itemId, locationId } });
  return Math.round(rows.reduce((n, r) => n + Number(r.qty), 0) * 1000) / 1000;
}
export const total = async (prisma: PrismaClient, itemId: string) =>
  Number((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).stock);

/** A hotel group with a central kitchen (its store and hot kitchen) and an outlet's bar and store. */
export async function kitchens(w: World) {
  const g = await group(w);
  const store = await loc(w, g.b.kitchen.id, 'Central store');
  const hot = await loc(w, g.b.kitchen.id, 'Hot kitchen', 'KITCHEN');
  const bar = await loc(w, g.b.rooftop.id, 'Rooftop bar', 'BAR');
  const pantry = await loc(w, g.b.rooftop.id, 'Rooftop pantry');
  const lake = await loc(w, g.b.lake.id, 'Lake store');
  return { g, store, hot, bar, pantry, lake };
}
/** Give a built-in role the stock and money rights a store keeper needs, limited to their own branches. */
export async function storeKeepers(prisma: PrismaClient, w: World, key = 'HOD') {
  const role = await prisma.role.findUniqueOrThrow({ where: { id: w.role(key) } });
  await ok(
    w.api.patch(`/api/org/roles/${role.id}`, {
      permissions: [
        ...new Set([
          ...role.permissions,
          'ims.view',
          'ims.create',
          'ims.edit',
          'ims.approve',
          'money.view',
          'money.create',
        ]),
      ],
      reach: 'branches',
    }),
  );
}
