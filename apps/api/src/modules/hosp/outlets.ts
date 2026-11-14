import type { Db } from '@mono/db';
import { kotRouteSchema, outletSchema, printerSchema, stationSchema, type OutletCharges } from '@mono/shared';
import type { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { branchOf, branchWhere, ctxOf, inReach, need, outletOf } from './access';

/**
 * Phase 14 — outlets (a restaurant, bar, café, room service, banquet, pool bar, counter) with their kitchen
 * stations, printers and ticket routing. An outlet belongs to a branch and takes its stock from one location.
 */
const admin = (a: Actor) => need(a, 'hosp.admin', 'Only hospitality admins change this set-up');

export async function listOutlets(db: Db, actor: Actor) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const outlets = await db.outlet.findMany({
    where: { companyId: actor.companyId, deletedAt: null, ...branchWhere() },
    orderBy: { name: 'asc' },
  });
  const ids = outlets.map((o) => o.id);
  const [stations, routes, floors, tables, branches] = await Promise.all([
    db.station.findMany({
      where: { companyId: actor.companyId, outletId: { in: ids }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    }),
    db.kotRoute.findMany({ where: { companyId: actor.companyId, outletId: { in: ids } } }),
    db.floor.findMany({
      where: { companyId: actor.companyId, outletId: { in: ids }, deletedAt: null },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    }),
    db.diningTable.groupBy({
      by: ['outletId'],
      where: { companyId: actor.companyId, outletId: { in: ids }, deletedAt: null },
      _count: true,
    }),
    db.branch.findMany({
      where: { companyId: actor.companyId, id: { in: outlets.map((o) => o.branchId) } },
      select: { id: true, name: true },
    }),
  ]);
  const branch = new Map(branches.map((b) => [b.id, b.name]));
  return outlets.map((o) => ({
    id: o.id,
    name: o.name,
    kind: o.kind,
    branchId: o.branchId,
    branch: branch.get(o.branchId) ?? '',
    locationId: o.locationId,
    stockRoutes: (o.stockRoutes ?? []) as { category: string; locationId: string }[],
    priceListId: o.priceListId,
    openMin: o.openMin,
    closeMin: o.closeMin,
    charges: o.charges as OutletCharges,
    billPrinterId: o.billPrinterId,
    active: o.active,
    stations: stations
      .filter((s) => s.outletId === o.id)
      .map((s) => ({ id: s.id, name: s.name, kind: s.kind, printerId: s.printerId, display: s.display })),
    routes: routes
      .filter((r) => r.outletId === o.id)
      .map((r) => ({ category: r.category, stationId: r.stationId })),
    floors: floors.filter((f) => f.outletId === o.id).map((f) => ({ id: f.id, name: f.name })),
    tables: tables.find((t) => t.outletId === o.id)?._count ?? 0,
  }));
}

export async function saveOutlet(db: Db, actor: Actor, input: z.input<typeof outletSchema>, id?: string) {
  admin(actor);
  const o = outletSchema.parse(input);
  await branchOf(db, actor.companyId, o.branchId);
  if (
    o.locationId &&
    !(await db.location.count({
      where: { id: o.locationId, companyId: actor.companyId, branchId: o.branchId, deletedAt: null },
    }))
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'The stock location must be one of the outlet’s branch');
  const routed = [...new Set(o.stockRoutes.map((r) => r.locationId))];
  if (
    routed.length &&
    (await db.location.count({
      where: { id: { in: routed }, companyId: actor.companyId, branchId: o.branchId, deletedAt: null },
    })) !== routed.length
  )
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'A category’s stock location must be one of the outlet’s branch',
    );
  if (
    o.priceListId &&
    !(await db.priceList.count({ where: { id: o.priceListId, companyId: actor.companyId, deletedAt: null } }))
  )
    throw notFound('Price list');
  if (
    o.charges.chargeTaxCode &&
    !(await db.taxRate.count({ where: { companyId: actor.companyId, code: o.charges.chargeTaxCode } }))
  )
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `There is no tax rate with the code ${o.charges.chargeTaxCode}`,
    );
  if (id) await outletOf(db, actor.companyId, id);
  const taken = await db.outlet.count({
    where: {
      companyId: actor.companyId,
      branchId: o.branchId,
      name: o.name,
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (taken) throw new AppError(409, 'CONFLICT', `This branch already has an outlet called ${o.name}`);
  const data = { ...o, priceListId: o.priceListId ?? null, billPrinterId: o.billPrinterId ?? null };
  return db.$transaction(async (tx) => {
    const row = id
      ? await tx.outlet.update({ where: { id }, data })
      : await tx.outlet.create({ data: { companyId: actor.companyId, ...data } });
    await writeAudit(tx, ctxOf(actor), {
      action: id ? 'hosp.outlet_changed' : 'hosp.outlet_added',
      entityType: 'outlet',
      entityId: row.id,
      after: o,
    });
    return { id: row.id };
  });
}
export async function deleteOutlet(db: Db, actor: Actor, id: string) {
  admin(actor);
  await outletOf(db, actor.companyId, id);
  await db.$transaction(async (tx) => {
    const at = new Date();
    await tx.outlet.update({ where: { id }, data: { deletedAt: at } });
    await tx.station.updateMany({ where: { outletId: id, deletedAt: null }, data: { deletedAt: at } });
    await tx.floor.updateMany({ where: { outletId: id, deletedAt: null }, data: { deletedAt: at } });
    await tx.diningTable.updateMany({ where: { outletId: id, deletedAt: null }, data: { deletedAt: at } });
    await writeAudit(tx, ctxOf(actor), { action: 'hosp.outlet_deleted', entityType: 'outlet', entityId: id });
  });
  return { ok: true };
}

export async function saveStation(db: Db, actor: Actor, input: z.input<typeof stationSchema>, id?: string) {
  admin(actor);
  const s = stationSchema.parse(input);
  await outletOf(db, actor.companyId, s.outletId);
  if (
    s.printerId &&
    !(await db.printer.count({ where: { id: s.printerId, companyId: actor.companyId, deletedAt: null } }))
  )
    throw notFound('Printer');
  if (
    id &&
    !(await db.station.count({
      where: { id, companyId: actor.companyId, outletId: s.outletId, deletedAt: null },
    }))
  )
    throw notFound('Station');
  const data = { ...s, printerId: s.printerId ?? null };
  return db.$transaction(async (tx) => {
    const row = id
      ? await tx.station.update({ where: { id }, data })
      : await tx.station.create({ data: { companyId: actor.companyId, ...data } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.station_saved',
      entityType: 'station',
      entityId: row.id,
      after: s,
    });
    return { id: row.id };
  });
}
export async function deleteStation(db: Db, actor: Actor, id: string) {
  admin(actor);
  const s = await db.station.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!s) throw notFound('Station');
  await outletOf(db, actor.companyId, s.outletId);
  await db.$transaction(async (tx) => {
    await tx.station.update({ where: { id }, data: { deletedAt: new Date() } });
    // Tickets that were routed here fall back to the outlet's default station.
    await tx.kotRoute.deleteMany({ where: { stationId: id } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.station_deleted',
      entityType: 'station',
      entityId: id,
    });
  });
  return { ok: true };
}

/** Which station each menu category's tickets go to at an outlet: the whole list, replaced. */
export async function saveRoutes(db: Db, actor: Actor, input: z.input<typeof kotRouteSchema>) {
  admin(actor);
  const r = kotRouteSchema.parse(input);
  await outletOf(db, actor.companyId, r.outletId);
  const stations = new Set(
    (
      await db.station.findMany({
        where: { companyId: actor.companyId, outletId: r.outletId, deletedAt: null },
        select: { id: true },
      })
    ).map((s) => s.id),
  );
  if (r.routes.some((x) => !stations.has(x.stationId)))
    throw new AppError(400, 'VALIDATION_FAILED', 'A route points to a station of another outlet');
  if (new Set(r.routes.map((x) => x.category.toLowerCase())).size !== r.routes.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'A category is routed twice');
  await db.$transaction(async (tx) => {
    await tx.kotRoute.deleteMany({ where: { outletId: r.outletId } });
    if (r.routes.length)
      await tx.kotRoute.createMany({
        data: r.routes.map((x) => ({ companyId: actor.companyId, outletId: r.outletId, ...x })),
      });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.routes_saved',
      entityType: 'outlet',
      entityId: r.outletId,
      after: r.routes,
    });
  });
  return { ok: true };
}
/** The station a category's ticket goes to: its own route, else the outlet's default ("" route), else the first station. */
export async function stationFor(db: Db, companyId: string, outletId: string, category: string) {
  const routes = await db.kotRoute.findMany({ where: { companyId, outletId } });
  const hit =
    routes.find((r) => r.category.toLowerCase() === category.toLowerCase()) ??
    routes.find((r) => r.category === '');
  if (hit) return hit.stationId;
  return (
    (
      await db.station.findFirst({
        where: { companyId, outletId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      })
    )?.id ?? null
  );
}

export async function listPrinters(db: Db, actor: Actor) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const rows = await db.printer.findMany({
    where: { companyId: actor.companyId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  return rows
    .filter((p) => inReach(p.branchId) || p.branchId === null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      connection: p.connection,
      address: p.address,
      branchId: p.branchId,
    }));
}
export async function savePrinter(db: Db, actor: Actor, input: z.input<typeof printerSchema>, id?: string) {
  admin(actor);
  const p = printerSchema.parse(input);
  if (p.branchId) await branchOf(db, actor.companyId, p.branchId);
  if (p.connection === 'NETWORK' && p.address && !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(p.address))
    throw new AppError(400, 'VALIDATION_FAILED', 'A network printer is an address like 192.168.1.50:9100');
  if (id && !(await db.printer.count({ where: { id, companyId: actor.companyId, deletedAt: null } })))
    throw notFound('Printer');
  const data = { ...p, branchId: p.branchId ?? null, address: p.address ?? null };
  return db.$transaction(async (tx) => {
    const row = id
      ? await tx.printer.update({ where: { id }, data })
      : await tx.printer.create({ data: { companyId: actor.companyId, ...data } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.printer_saved',
      entityType: 'printer',
      entityId: row.id,
      after: p,
    });
    return { id: row.id };
  });
}
export async function deletePrinter(db: Db, actor: Actor, id: string) {
  admin(actor);
  const done = await db.printer.updateMany({
    where: { id, companyId: actor.companyId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!done.count) throw notFound('Printer');
  await db.station.updateMany({
    where: { companyId: actor.companyId, printerId: id },
    data: { printerId: null },
  });
  await db.outlet.updateMany({
    where: { companyId: actor.companyId, billPrinterId: id },
    data: { billPrinterId: null },
  });
  return { ok: true };
}
