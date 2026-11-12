import { z } from 'zod';
import { factorOf, type ItemUnit, type Made } from './units';

/**
 * Phase 13 — recipes (bill of materials). A recipe makes `outputQty` of its item from ingredient lines. A line's
 * yield % is how much of what is bought is usable (onion 85 %); its wastage % is what is lost on the way (spill,
 * trimming at the pass). Raw needed = qty ÷ yield × (1 + wastage). An ingredient that is itself a DISH (a gravy
 * made to order) is opened through its own recipe; one that is stocked (BUY / MAKE) is taken from stock.
 */
export const recipeLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().positive().max(1e9),
  unit: z.string().trim().max(12).nullish(),
  yieldPct: z.number().min(1).max(100).default(100),
  wastagePct: z.number().min(0).max(100).default(0),
});
export const recipeSchema = z.object({
  itemId: z.string().min(1),
  outputQty: z.number().positive().max(1e9).default(1),
  note: z.string().trim().max(500).nullish(),
  lines: z.array(recipeLineSchema).min(1).max(100),
});
export type RecipeLine = z.infer<typeof recipeLineSchema>;
export type RecipeInput = z.infer<typeof recipeSchema>;

export type RecipeItem = { id: string; unit: string; units?: ItemUnit[] | null; made: Made; rate: number };
export type RecipeOf = { outputQty: number; lines: RecipeLine[] };
type Books = { items: Map<string, RecipeItem>; recipes: Map<string, RecipeOf> };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** What one line takes from stock, in the ingredient's stock unit, to make the recipe once. */
export function rawQty(line: RecipeLine, item: RecipeItem): number {
  const f = factorOf(item, line.unit);
  if (f === null) throw new Error(`UNKNOWN_UNIT:${line.unit}`);
  return (line.qty * f * (1 + (line.wastagePct ?? 0) / 100)) / ((line.yieldPct ?? 100) / 100);
}

/**
 * The stocked ingredients needed for `qty` of an item, in their stock units. DISH ingredients are opened
 * (any depth); a loop or a DISH with no recipe is an error the caller shows.
 */
export function explode(books: Books, itemId: string, qty: number, path: string[] = []): Map<string, number> {
  const out = new Map<string, number>();
  const recipe = books.recipes.get(itemId);
  if (!recipe) throw new Error(`NO_RECIPE:${itemId}`);
  if (path.includes(itemId)) throw new Error(`RECIPE_LOOP:${itemId}`);
  const times = qty / recipe.outputQty;
  for (const line of recipe.lines) {
    const item = books.items.get(line.itemId);
    if (!item) throw new Error(`NO_ITEM:${line.itemId}`);
    const need = rawQty(line, item) * times;
    const parts =
      item.made === 'DISH' ? explode(books, item.id, need, [...path, itemId]) : new Map([[item.id, need]]);
    for (const [id, n] of parts) out.set(id, round3((out.get(id) ?? 0) + n));
  }
  return out;
}

/** What one unit of an item costs: a stocked item its rate; anything with a recipe, its ingredients (any depth). */
export function costOf(books: Books, itemId: string, path: string[] = []): number {
  const item = books.items.get(itemId);
  const recipe = books.recipes.get(itemId);
  if (!recipe || (item && item.made === 'BUY')) return item?.rate ?? 0;
  if (path.includes(itemId)) throw new Error(`RECIPE_LOOP:${itemId}`);
  let total = 0;
  for (const line of recipe.lines) {
    const ing = books.items.get(line.itemId);
    if (!ing) continue;
    total += rawQty(line, ing) * costOf(books, ing.id, [...path, itemId]);
  }
  return Math.round(total / recipe.outputQty);
}
/** Food cost % of a selling price (both in the same minor units); null with no price. */
export const foodCostPct = (cost: number, price: number | null | undefined) =>
  price && price > 0 ? Math.round((cost / price) * 1000) / 10 : null;
