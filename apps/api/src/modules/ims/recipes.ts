import type { Db, Tx } from '@mono/db';
import {
  costOf,
  explode,
  factorOf,
  foodCostPct,
  recipeSchema,
  type ItemUnit,
  type Made,
  type RecipeItem,
  type RecipeLine,
  type RecipeOf,
} from '@mono/shared';
import type { z } from 'zod';
import type { ActorContext } from '../../lib/audit';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { applyMove } from './moves';
import { num, r3 } from './v2';

/**
 * Phase 13 — recipes. Saving a recipe makes a new version and switches the old one off; what was sold or made
 * on an older version keeps its moves. Cost is always worked out from the items' latest rates.
 */
export type Books = { items: Map<string, RecipeItem>; recipes: Map<string, RecipeOf> };
/** Every item and active recipe of the company, in the shape the shared rules read. */
export async function booksOf(db: Db | Tx, companyId: string): Promise<Books> {
  const [items, recipes] = await Promise.all([
    db.item.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, unit: true, units: true, made: true, rate: true },
    }),
    db.recipe.findMany({ where: { companyId, active: true } }),
  ]);
  return {
    items: new Map(
      items.map((i) => [
        i.id,
        {
          id: i.id,
          unit: i.unit,
          units: (i.units as ItemUnit[] | null) ?? [],
          made: i.made as Made,
          rate: Number(i.rate),
        },
      ]),
    ),
    recipes: new Map(
      recipes.map((r) => [r.itemId, { outputQty: num(r.outputQty), lines: r.lines as RecipeLine[] }]),
    ),
  };
}
const explain = (e: unknown, names: Map<string, string>) => {
  const [code, id] = String((e as Error).message).split(':');
  const name = names.get(id ?? '') ?? 'An item';
  if (code === 'RECIPE_LOOP') return `${name} ends up inside its own recipe`;
  if (code === 'NO_RECIPE') return `${name} has no recipe yet`;
  if (code === 'UNKNOWN_UNIT') return `An ingredient has no unit called ${id}`;
  return 'The recipe could not be worked out';
};

export async function saveRecipe(db: Db, actor: Actor, input: z.input<typeof recipeSchema>) {
  need(actor, 'ims.edit', "You can't change recipes");
  const r = recipeSchema.parse(input);
  const ids = [r.itemId, ...r.lines.map((l) => l.itemId)];
  const rows = await db.item.findMany({
    where: { companyId: actor.companyId, id: { in: ids }, deletedAt: null },
  });
  const byId = new Map(rows.map((i) => [i.id, i]));
  const item = byId.get(r.itemId);
  if (!item) throw notFound('Item');
  if (item.made === 'BUY')
    throw new AppError(
      409,
      'CONFLICT',
      `${item.name} is bought, not made: mark it as made or as a dish first`,
    );
  if (r.lines.some((l) => l.itemId === r.itemId))
    throw new AppError(400, 'VALIDATION_FAILED', `${item.name} can't be its own ingredient`);
  if (new Set(r.lines.map((l) => l.itemId)).size !== r.lines.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'An ingredient is listed twice');
  for (const l of r.lines) {
    const ing = byId.get(l.itemId);
    if (!ing) throw new AppError(400, 'VALIDATION_FAILED', 'An ingredient is not in the item master');
    if (factorOf({ unit: ing.unit, units: ing.units as ItemUnit[] | null }, l.unit) === null)
      throw new AppError(400, 'VALIDATION_FAILED', `${ing.name} has no unit called ${l.unit}`);
  }
  // A loop (gravy → paneer dish → gravy) is refused before it is saved.
  const books = await booksOf(db, actor.companyId);
  books.recipes.set(r.itemId, { outputQty: r.outputQty, lines: r.lines });
  const names = new Map(
    (await db.item.findMany({ where: { companyId: actor.companyId }, select: { id: true, name: true } })).map(
      (i) => [i.id, i.name],
    ),
  );
  try {
    costOf(books, r.itemId);
  } catch (e) {
    throw new AppError(400, 'VALIDATION_FAILED', explain(e, names));
  }
  return db.$transaction(async (tx) => {
    const last = await tx.recipe.findFirst({ where: { itemId: r.itemId }, orderBy: { version: 'desc' } });
    await tx.recipe.updateMany({
      where: { companyId: actor.companyId, itemId: r.itemId, active: true },
      data: { active: false },
    });
    const row = await tx.recipe.create({
      data: {
        companyId: actor.companyId,
        itemId: r.itemId,
        version: (last?.version ?? 0) + 1,
        outputQty: r.outputQty,
        lines: r.lines,
        note: r.note ?? null,
        createdById: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.recipe_saved',
      entityType: 'recipe',
      entityId: row.id,
      after: r,
    });
    return { id: row.id, version: row.version };
  });
}

/** Active recipes with their cost from the latest rates and food cost % against the selling price. */
export async function listRecipes(db: Db, actor: Actor, itemId?: string) {
  need(actor, 'ims.view', "You can't see stock");
  const rows = await db.recipe.findMany({
    where: { companyId: actor.companyId, ...(itemId ? { itemId } : { active: true }) },
    orderBy: [{ itemId: 'asc' }, { version: 'desc' }],
  });
  const books = await booksOf(db, actor.companyId);
  const items = new Map(
    (
      await db.item.findMany({
        where: { companyId: actor.companyId },
        select: { id: true, code: true, name: true, unit: true, sellPrice: true, made: true },
      })
    ).map((i) => [i.id, i]),
  );
  const out = rows.map((r) => {
    const item = items.get(r.itemId);
    const lines = r.lines as RecipeLine[];
    const cost = ((): number | null => {
      if (!r.active) return null;
      try {
        return costOf(books, r.itemId);
      } catch {
        return null;
      }
    })();
    const price = item?.sellPrice === null || item?.sellPrice === undefined ? null : Number(item.sellPrice);
    return {
      id: r.id,
      itemId: r.itemId,
      code: item?.code ?? '',
      name: item?.name ?? '',
      unit: item?.unit ?? '',
      made: item?.made ?? 'DISH',
      version: r.version,
      active: r.active,
      outputQty: num(r.outputQty),
      note: r.note,
      createdAt: r.createdAt,
      cost,
      sellPrice: price,
      foodCostPct: cost === null ? null : foodCostPct(cost, price),
      lines: lines.map((l) => ({
        ...l,
        name: items.get(l.itemId)?.name ?? '',
        stockUnit: items.get(l.itemId)?.unit ?? '',
      })),
    };
  });
  return out.sort((x, y) => x.name.localeCompare(y.name) || y.version - x.version);
}

/**
 * Stock used by a sale or a kitchen: a DISH is opened through its recipe (any depth) and each stocked
 * ingredient is issued at the location; a stocked item is issued as itself. Returns the cost that left.
 */
export async function consume(
  tx: Tx,
  ctx: ActorContext,
  a: {
    itemId: string;
    qty: number;
    locationId: string;
    batchId?: string | null;
    refType: string;
    refId: string;
    note?: string | null;
    at?: Date;
  },
) {
  const item = await tx.item.findFirst({
    where: { id: a.itemId, companyId: ctx.companyId, deletedAt: null },
  });
  if (!item) throw notFound('Item');
  const base = { locationId: a.locationId, refType: a.refType, refId: a.refId, note: a.note, at: a.at };
  if (item.made !== 'DISH') {
    const r = await applyMove(tx, ctx, {
      ...base,
      itemId: item.id,
      type: 'OUT',
      delta: -a.qty,
      reason: 'SALE',
      batchId: a.batchId,
    });
    return { cost: r.value, used: [{ itemId: item.id, qty: a.qty, value: r.value }] };
  }
  const books = await booksOf(tx, ctx.companyId);
  let need: Map<string, number>;
  try {
    need = explode(books, item.id, a.qty);
  } catch (e) {
    const names = new Map(
      (await tx.item.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true } })).map(
        (i) => [i.id, i.name],
      ),
    );
    throw new AppError(409, 'CONFLICT', explain(e, names));
  }
  const used = [];
  for (const [itemId, qty] of need) {
    if (qty <= 0) continue;
    const r = await applyMove(tx, ctx, { ...base, itemId, type: 'OUT', delta: -r3(qty), reason: 'RECIPE' });
    used.push({ itemId, qty: r3(qty), value: r.value });
  }
  return { cost: used.reduce((n, u) => n + u.value, 0), used };
}
