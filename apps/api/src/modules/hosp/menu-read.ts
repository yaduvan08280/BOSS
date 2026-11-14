import type { Db } from '@mono/db';
import {
  availableAt,
  explode,
  localDate,
  priceAt,
  type ModifierGroupInput,
  type TimeWindow,
  type Variant,
  branchRulesSchema,
  dryDayOn,
  isLiquor,
  stockPlaceFor,
} from '@mono/shared';
import { booksOf } from '../ims/recipes';
import type { Actor } from '../work/actor';
import { need, outletOf } from './access';

/**
 * The menu an outlet sells right now: each item with its price here at this time, whether it can be ordered
 * (availability windows), and whether it is 86 — switched off by a person, or because the outlet's stock can't
 * make even one (auto, from the recipe).
 */
const clock = (at: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { minuteOfDay: (Number(get('hour')) % 24) * 60 + Number(get('minute')), weekday: weekday || 1 };
};

export async function menuFor(db: Db, actor: Actor, outletId: string, at = new Date()) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const outlet = await outletOf(db, actor.companyId, outletId);
  const [branch, company] = await Promise.all([
    db.branch.findFirst({ where: { id: outlet.branchId }, select: { timezone: true } }),
    db.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { timezone: true } }),
  ]);
  const tz = branch?.timezone ?? company.timezone;
  const now = clock(at, tz);
  const today = localDate(at, tz);
  const where = { companyId: actor.companyId, deletedAt: null };
  // Every location this outlet takes stock from: its own, and any a menu category is routed to.
  const stockRoutes = (outlet.stockRoutes ?? []) as { category: string; locationId: string }[];
  const places = [...new Set([outlet.locationId, ...stockRoutes.map((r) => r.locationId)])];
  const [categories, items, groups, prices, routes, books, balances] = await Promise.all([
    db.menuCategory.findMany({ where, orderBy: [{ sort: 'asc' }, { name: 'asc' }] }),
    db.menuItem.findMany({ where: { ...where, active: true }, orderBy: { name: 'asc' } }),
    db.modifierGroup.findMany({ where }),
    db.menuPrice.findMany({ where: { companyId: actor.companyId } }),
    db.kotRoute.findMany({ where: { companyId: actor.companyId, outletId } }),
    booksOf(db, actor.companyId),
    db.stockBalance.findMany({
      where: { companyId: actor.companyId, locationId: { in: places }, qty: { gt: 0 } },
    }),
  ]);
  // What the outlet's location can still use: expired batches don't count.
  const expired = new Set(
    (
      await db.stockBatch.findMany({
        where: {
          companyId: actor.companyId,
          id: { in: balances.map((b) => b.batchId).filter(Boolean) },
          expiry: { lt: today },
        },
        select: { id: true },
      })
    ).map((b) => b.id),
  );
  const held = new Map<string, number>();
  for (const b of balances)
    if (!expired.has(b.batchId)) {
      const k = `${b.locationId}|${b.itemId}`;
      held.set(k, (held.get(k) ?? 0) + Number(b.qty));
    }
  const names = new Map(
    (await db.item.findMany({ where: { companyId: actor.companyId }, select: { id: true, name: true } })).map(
      (i) => [i.id, i.name],
    ),
  );
  /** The first ingredient the location is short of to make `qty` of a stock item; null = it can be made. */
  const shortOf = (itemId: string | null | undefined, qty: number, place: string): string | null => {
    if (!itemId) return null;
    const item = books.items.get(itemId);
    if (!item) return null;
    let needs: Map<string, number>;
    try {
      needs = item.made === 'DISH' ? explode(books, itemId, qty) : new Map([[itemId, qty]]);
    } catch {
      // A dish with no recipe can't be checked against stock: it is not switched off for that.
      return null;
    }
    for (const [id, n] of needs)
      if ((held.get(`${place}|${id}`) ?? 0) + 1e-9 < n) return names.get(id) ?? 'stock';
    return null;
  };
  // Tickets with no route of their own go to the outlet's default route, else to its first station.
  const defaultStation =
    routes.find((r) => r.category === '')?.stationId ??
    (
      await db.station.findFirst({
        where: { companyId: actor.companyId, outletId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      })
    )?.id ??
    null;
  // A dry day (phase 18): liquor is off the menu at this branch for that calendar day.
  const ruleRow = await db.branchRule.findUnique({ where: { branchId: outlet.branchId } });
  const bar = branchRulesSchema.safeParse(ruleRow?.rules ?? {});
  const dry = bar.success ? dryDayOn(bar.data.bar, today) : null;
  // Every stock item's category: a peg sold through its recipe is liquor because its ingredient is.
  const stockCategory = dry
    ? new Map(
        (
          await db.item.findMany({
            where: { companyId: actor.companyId, deletedAt: null },
            select: { id: true, category: true },
          })
        ).map((x) => [x.id, x.category]),
      )
    : new Map<string, string | null>();
  const madeOf = (itemId: string): string[] => {
    try {
      return books.items.get(itemId)?.made === 'DISH' ? [...explode(books, itemId, 1).keys()] : [itemId];
    } catch {
      return [itemId];
    }
  };
  const liquor = (category: string, itemId: string | null) =>
    Boolean(dry && bar.success) &&
    (isLiquor(bar.data!.bar, category) ||
      (itemId ? [itemId, ...madeOf(itemId)] : []).some((id) =>
        isLiquor(bar.data!.bar, stockCategory.get(id)),
      ));
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  const mine = items.filter((i) => !i.outletIds.length || i.outletIds.includes(outletId));
  const menuPrices = (id: string) =>
    prices
      .filter((p) => p.menuItemId === id)
      .map((p) => ({
        variantKey: p.variantKey,
        outletId: p.outletId,
        window: p.window as TimeWindow | null,
        price: Number(p.price),
        label: p.label,
      }));
  return {
    outlet: { id: outlet.id, name: outlet.name, kind: outlet.kind, locationId: outlet.locationId },
    at: { minuteOfDay: now.minuteOfDay, weekday: now.weekday, date: today },
    categories: categories
      .map((c) => ({
        id: c.id,
        name: c.name,
        nameHi: c.nameHi,
        stationId:
          routes.find((r) => r.category.toLowerCase() === c.name.toLowerCase())?.stationId ?? defaultStation,
        items: mine
          .filter((i) => i.categoryId === c.id)
          .map((i) => {
            const place = stockPlaceFor(outlet, c.name);
            const ps = menuPrices(i.id);
            const base = priceAt(Number(i.price), ps, { outletId, ...now });
            const variants = ((i.variants as Variant[] | null) ?? []).map((v) => {
              const p = priceAt(v.price, ps, { outletId, variantKey: v.key, ...now });
              return {
                key: v.key,
                name: v.name,
                price: p.price,
                label: p.label,
                short: shortOf(v.itemId ?? i.itemId, v.itemId ? 1 : (v.factor ?? 1), place),
              };
            });
            const combo = (i.combo as { menuItemId: string; qty: number }[] | null) ?? [];
            // A combo is short when any of its parts is; an item with variants when every variant is.
            const comboShort =
              combo
                .map((part) => shortOf(items.find((x) => x.id === part.menuItemId)?.itemId, part.qty, place))
                .find(Boolean) ?? null;
            const short = combo.length
              ? comboShort
              : variants.length
                ? variants.every((v) => v.short)
                  ? variants[0]!.short
                  : null
                : shortOf(i.itemId, 1, place);
            const dryOff = liquor(c.name, i.itemId);
            const out = i.off || dryOff ? ('off' as const) : short ? ('stock' as const) : null;
            return {
              id: i.id,
              name: i.name,
              nameHi: i.nameHi,
              code: i.code,
              itemId: i.itemId,
              diet: i.diet,
              allergens: i.allergens,
              spice: i.spice,
              photoId: i.photoId,
              hsn: i.hsn,
              taxCode: i.taxCode,
              price: base.price,
              label: base.label,
              available: availableAt((i.windows as TimeWindow[] | null) ?? [], now.minuteOfDay, now.weekday),
              out,
              outReason: dryOff ? `Dry day — ${dry!.reason}` : i.off ? i.offReason : short,
              variants: variants.map((v) => ({ ...v, out: Boolean(v.short) })),
              combo,
              modifierGroups: i.modifierGroupIds
                .map((id) => groupOf.get(id))
                .filter((g): g is NonNullable<typeof g> => Boolean(g))
                .map((g) => ({
                  id: g.id,
                  name: g.name,
                  min: g.min,
                  max: g.max,
                  options: g.options as ModifierGroupInput['options'],
                })),
            };
          }),
      }))
      .filter((c) => c.items.length),
  };
}
