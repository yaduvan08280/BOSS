import type { Db, Tx } from '@mono/db';
import {
  menuCategorySchema,
  menuItemSchema,
  menuPriceSchema,
  modifierGroupSchema,
  parseMenuRows,
  type MenuItemInput,
  type ModifierGroupInput,
  type TimeWindow,
  type Variant,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';

/**
 * Phase 14 — the menu: categories, items (linked to a stock item and its recipe), variants, modifier groups with
 * a stock effect, combos, prices per outlet and time band, availability windows and the 86 switch.
 */
const edit = (a: Actor) => need(a, 'hosp.edit', "You can't change the menu");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'x';

export async function saveCategory(
  db: Db,
  actor: Actor,
  input: z.input<typeof menuCategorySchema>,
  id?: string,
) {
  edit(actor);
  const c = menuCategorySchema.parse(input);
  const taken = await db.menuCategory.count({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      name: { equals: c.name, mode: 'insensitive' },
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (taken) throw new AppError(409, 'CONFLICT', `There is already a category called ${c.name}`);
  if (id && !(await db.menuCategory.count({ where: { id, companyId: actor.companyId, deletedAt: null } })))
    throw notFound('Category');
  const data = { ...c, nameHi: c.nameHi ?? null };
  const row = id
    ? await db.menuCategory.update({ where: { id }, data })
    : await db.menuCategory.create({ data: { companyId: actor.companyId, ...data } });
  return { id: row.id };
}
export async function deleteCategory(db: Db, actor: Actor, id: string) {
  edit(actor);
  if (await db.menuItem.count({ where: { companyId: actor.companyId, categoryId: id, deletedAt: null } }))
    throw new AppError(409, 'CONFLICT', 'The category still has items: move or delete them first');
  const done = await db.menuCategory.updateMany({
    where: { id, companyId: actor.companyId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!done.count) throw notFound('Category');
  return { ok: true };
}

const stockItems = async (db: Db | Tx, companyId: string, ids: (string | null | undefined)[]) => {
  const want = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (
    want.length &&
    (await db.item.count({ where: { companyId, id: { in: want }, deletedAt: null } })) !== want.length
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'A stock item chosen is not in the item master');
};

export async function saveModifierGroup(
  db: Db,
  actor: Actor,
  input: z.input<typeof modifierGroupSchema>,
  id?: string,
) {
  edit(actor);
  const g = modifierGroupSchema.parse(input);
  if (g.min > g.max)
    throw new AppError(400, 'VALIDATION_FAILED', 'The least to pick can’t be more than the most');
  if (new Set(g.options.map((o) => o.key)).size !== g.options.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Two options have the same key');
  if (g.options.some((o) => o.itemId && !o.qty))
    throw new AppError(400, 'VALIDATION_FAILED', 'An option that uses stock needs a quantity');
  await stockItems(
    db,
    actor.companyId,
    g.options.map((o) => o.itemId),
  );
  if (id && !(await db.modifierGroup.count({ where: { id, companyId: actor.companyId, deletedAt: null } })))
    throw notFound('Modifier group');
  const row = id
    ? await db.modifierGroup.update({ where: { id }, data: g })
    : await db.modifierGroup.create({ data: { companyId: actor.companyId, ...g } });
  return { id: row.id };
}
export async function deleteModifierGroup(db: Db, actor: Actor, id: string) {
  edit(actor);
  const done = await db.modifierGroup.updateMany({
    where: { id, companyId: actor.companyId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!done.count) throw notFound('Modifier group');
  for (const m of await db.menuItem.findMany({
    where: { companyId: actor.companyId, modifierGroupIds: { has: id } },
  }))
    await db.menuItem.update({
      where: { id: m.id },
      data: { modifierGroupIds: m.modifierGroupIds.filter((x) => x !== id) },
    });
  return { ok: true };
}

async function checkItem(db: Db | Tx, companyId: string, m: MenuItemInput, id?: string) {
  if (!(await db.menuCategory.count({ where: { id: m.categoryId, companyId, deletedAt: null } })))
    throw notFound('Category');
  await stockItems(db, companyId, [m.itemId, ...m.variants.map((v) => v.itemId)]);
  if (m.taxCode && !(await db.taxRate.count({ where: { companyId, code: m.taxCode } })))
    throw new AppError(400, 'VALIDATION_FAILED', `There is no tax rate with the code ${m.taxCode}`);
  if (new Set(m.variants.map((v) => v.key)).size !== m.variants.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Two variants have the same key');
  if (
    m.modifierGroupIds.length &&
    (await db.modifierGroup.count({
      where: { companyId, id: { in: m.modifierGroupIds }, deletedAt: null },
    })) !== m.modifierGroupIds.length
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'A modifier group chosen does not exist');
  if (m.combo.length) {
    if (m.variants.length) throw new AppError(400, 'VALIDATION_FAILED', 'A combo has no variants of its own');
    const parts = await db.menuItem.findMany({
      where: { companyId, id: { in: m.combo.map((c) => c.menuItemId) }, deletedAt: null },
    });
    if (parts.length !== new Set(m.combo.map((c) => c.menuItemId)).size)
      throw new AppError(400, 'VALIDATION_FAILED', 'A combo item is not on the menu');
    if (parts.some((p) => p.id === id || (p.combo as unknown[] | null)?.length))
      throw new AppError(400, 'VALIDATION_FAILED', 'A combo can’t contain itself or another combo');
  }
  if (
    m.outletIds.length &&
    (await db.outlet.count({ where: { companyId, id: { in: m.outletIds }, deletedAt: null } })) !==
      m.outletIds.length
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'An outlet chosen does not exist');
}
const itemData = (m: MenuItemInput) => ({
  ...m,
  nameHi: m.nameHi ?? null,
  code: m.code ?? null,
  itemId: m.itemId ?? null,
  photoId: m.photoId ?? null,
  hsn: m.hsn ?? null,
  taxCode: m.taxCode ?? null,
  price: BigInt(m.price),
});

export async function saveMenuItem(db: Db, actor: Actor, input: z.input<typeof menuItemSchema>, id?: string) {
  edit(actor);
  const m = menuItemSchema.parse(input);
  await checkItem(db, actor.companyId, m, id);
  if (id && !(await db.menuItem.count({ where: { id, companyId: actor.companyId, deletedAt: null } })))
    throw notFound('Menu item');
  return db.$transaction(async (tx) => {
    const row = id
      ? await tx.menuItem.update({ where: { id }, data: itemData(m) })
      : await tx.menuItem.create({ data: { companyId: actor.companyId, ...itemData(m) } });
    // A price kept for a variant that no longer exists is dropped.
    await tx.menuPrice.deleteMany({
      where: { menuItemId: row.id, variantKey: { notIn: ['', ...m.variants.map((v) => v.key)] } },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: id ? 'hosp.menu_item_changed' : 'hosp.menu_item_added',
      entityType: 'menu_item',
      entityId: row.id,
      after: m,
    });
    return { id: row.id };
  });
}
export async function deleteMenuItem(db: Db, actor: Actor, id: string) {
  edit(actor);
  const inCombo = await db.menuItem.findFirst({
    where: { companyId: actor.companyId, deletedAt: null, combo: { array_contains: [{ menuItemId: id }] } },
  });
  if (inCombo) throw new AppError(409, 'CONFLICT', `It is part of the combo ${inCombo.name}`);
  const done = await db.menuItem.updateMany({
    where: { id, companyId: actor.companyId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!done.count) throw notFound('Menu item');
  return { ok: true };
}

export const pricesSchema = z.object({ prices: z.array(menuPriceSchema.omit({ menuItemId: true })).max(60) });
/** The prices of one item that differ by outlet or time band: the whole list, replaced. */
export async function savePrices(
  db: Db,
  actor: Actor,
  menuItemId: string,
  input: z.input<typeof pricesSchema>,
) {
  edit(actor);
  const p = pricesSchema.parse(input);
  const item = await db.menuItem.findFirst({
    where: { id: menuItemId, companyId: actor.companyId, deletedAt: null },
  });
  if (!item) throw notFound('Menu item');
  const keys = new Set(['', ...((item.variants as Variant[] | null) ?? []).map((v) => v.key)]);
  if (p.prices.some((x) => !keys.has(x.variantKey)))
    throw new AppError(400, 'VALIDATION_FAILED', 'A price is for a variant the item does not have');
  const outlets = [...new Set(p.prices.map((x) => x.outletId).filter((x): x is string => Boolean(x)))];
  if (
    outlets.length &&
    (await db.outlet.count({
      where: { companyId: actor.companyId, id: { in: outlets }, deletedAt: null },
    })) !== outlets.length
  )
    throw notFound('Outlet');
  await db.$transaction(async (tx) => {
    await tx.menuPrice.deleteMany({ where: { menuItemId } });
    if (p.prices.length)
      await tx.menuPrice.createMany({
        data: p.prices.map((x) => ({
          companyId: actor.companyId,
          menuItemId,
          variantKey: x.variantKey,
          outletId: x.outletId ?? null,
          label: x.label ?? null,
          window: x.window ?? undefined,
          price: BigInt(x.price),
        })),
      });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.menu_prices_saved',
      entityType: 'menu_item',
      entityId: menuItemId,
      after: p.prices,
    });
  });
  return { ok: true };
}

/** 86: a person switches an item off (the kitchen has run out) or on again. */
export async function set86(db: Db, actor: Actor, id: string, off: boolean, reason?: string | null) {
  need(actor, 'hosp.create', "You can't switch menu items off");
  const item = await db.menuItem.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!item) throw notFound('Menu item');
  await db.$transaction(async (tx) => {
    await tx.menuItem.update({ where: { id }, data: { off, offReason: off ? (reason ?? null) : null } });
    await writeAudit(tx, ctxOf(actor), {
      action: off ? 'hosp.menu_86' : 'hosp.menu_back',
      entityType: 'menu_item',
      entityId: id,
      after: { reason: reason ?? null },
    });
  });
  return { id, off };
}

/** A pasted menu (category, name, price, diet, variants): all or nothing, with problems named by line. */
export async function importMenu(db: Db, actor: Actor, text: string) {
  edit(actor);
  const { rows, problems } = parseMenuRows(text);
  const have = await db.menuItem.findMany({
    where: { companyId: actor.companyId, deletedAt: null },
    select: { name: true },
  });
  const names = new Set(have.map((h) => h.name.toLowerCase()));
  for (const r of rows) {
    if (names.has(r.name.toLowerCase()))
      problems.push({ line: r.line, message: `${r.name} is already on the menu` });
    names.add(r.name.toLowerCase());
  }
  if (problems.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'The menu was not imported', {
      problems: problems.sort((a, b) => a.line - b.line),
    });
  if (!rows.length) throw new AppError(400, 'VALIDATION_FAILED', 'Nothing to import');
  return db.$transaction(async (tx) => {
    const cats = new Map(
      (await tx.menuCategory.findMany({ where: { companyId: actor.companyId, deletedAt: null } })).map(
        (c) => [c.name.toLowerCase(), c.id],
      ),
    );
    let made = 0;
    for (const r of rows) {
      let categoryId = cats.get(r.category.toLowerCase());
      if (!categoryId) {
        categoryId = (
          await tx.menuCategory.create({
            data: { companyId: actor.companyId, name: r.category, sort: cats.size },
          })
        ).id;
        cats.set(r.category.toLowerCase(), categoryId);
        made += 1;
      }
      await tx.menuItem.create({
        data: {
          companyId: actor.companyId,
          categoryId,
          name: r.name,
          diet: r.diet,
          price: BigInt(r.price),
          variants: r.variants.map((v) => ({ key: slug(v.name), name: v.name, price: v.price, factor: 1 })),
        },
      });
    }
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.menu_imported',
      entityType: 'menu',
      entityId: actor.companyId,
      after: { items: rows.length, categories: made },
    });
    return { items: rows.length, categories: made };
  });
}

/** The whole menu as it is set up (for the menu screen): categories, items, modifier groups, prices. */
export async function menuSetup(db: Db, actor: Actor) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const where = { companyId: actor.companyId, deletedAt: null };
  const [categories, items, groups, prices] = await Promise.all([
    db.menuCategory.findMany({ where, orderBy: [{ sort: 'asc' }, { name: 'asc' }] }),
    db.menuItem.findMany({ where, orderBy: { name: 'asc' } }),
    db.modifierGroup.findMany({ where, orderBy: { name: 'asc' } }),
    db.menuPrice.findMany({ where: { companyId: actor.companyId } }),
  ]);
  return {
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      nameHi: c.nameHi,
      sort: c.sort,
      items: items.filter((i) => i.categoryId === c.id).length,
    })),
    items: items.map((i) => ({
      id: i.id,
      categoryId: i.categoryId,
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
      price: Number(i.price),
      variants: (i.variants as Variant[] | null) ?? [],
      modifierGroupIds: i.modifierGroupIds,
      combo: (i.combo as { menuItemId: string; qty: number }[] | null) ?? [],
      windows: (i.windows as TimeWindow[] | null) ?? [],
      outletIds: i.outletIds,
      active: i.active,
      off: i.off,
      offReason: i.offReason,
      prices: prices
        .filter((p) => p.menuItemId === i.id)
        .map((p) => ({
          variantKey: p.variantKey,
          outletId: p.outletId,
          label: p.label,
          window: p.window as TimeWindow | null,
          price: Number(p.price),
        })),
    })),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      min: g.min,
      max: g.max,
      options: g.options as ModifierGroupInput['options'],
    })),
  };
}
