import type { Db } from '@mono/db';
import type { Pack, PackKind } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { savePriceList } from '../ims/prices';
import { saveRecipe } from '../ims/recipes';
import { attributesSchema, saveAttributes } from '../ims/stock-attrs';
import type { Actor } from '../work/actor';

/** "Make this once" — the installer's own rule (see install.ts). */
export type One = (
  kind: PackKind,
  key: string,
  find: () => Promise<string | null | undefined>,
  alive: (id: string) => Promise<boolean>,
  create: () => Promise<string>,
) => Promise<string>;

/**
 * The stock side of a pack, after its items exist: what a category's pieces carry, price lists by kind of
 * party, and bills of material. Items are named by their code; a code the company does not have is a mistake in
 * the pack.
 */
export async function installStock(db: Db, actor: Actor, pack: Pack, one: One) {
  const companyId = actor.companyId;
  const codes = [
    ...new Set([
      ...pack.priceLists.flatMap((p) => p.lines.map((l) => l.code)),
      ...pack.recipes.flatMap((r) => [r.code, ...r.lines.map((l) => l.code)]),
    ]),
  ];
  const items = new Map(
    (
      await db.item.findMany({
        where: { companyId, deletedAt: null, code: { in: codes } },
        select: { id: true, code: true },
      })
    ).map((i) => [i.code, i.id]),
  );
  const idOf = (code: string) => {
    const id = items.get(code);
    if (!id) throw new AppError(400, 'VALIDATION_FAILED', `The pack names an item it does not hold: ${code}`);
    return id;
  };
  const category = (c: string) => ({ companyId_category: { companyId, category: c } });
  for (const a of pack.attributes)
    await one(
      'attr',
      a.category,
      async () => (await db.itemAttribute.findUnique({ where: category(a.category) }))?.id,
      async (id) => Boolean(await db.itemAttribute.count({ where: { id, companyId } })),
      async () => {
        await saveAttributes(db, actor, attributesSchema.parse(a));
        return (await db.itemAttribute.findUniqueOrThrow({ where: category(a.category) })).id;
      },
    );
  for (const p of pack.priceLists)
    await one(
      'price',
      p.key,
      async () =>
        (
          await db.priceList.findFirst({
            where: { companyId, deletedAt: null, name: { equals: p.name, mode: 'insensitive' } },
          })
        )?.id,
      async (id) => Boolean(await db.priceList.count({ where: { id, companyId, deletedAt: null } })),
      async () =>
        (
          await savePriceList(db, actor, {
            name: p.name,
            partyKind: p.partyKind ?? null,
            from: '2000-01-01',
            lines: p.lines.map((l) => ({ itemId: idOf(l.code), price: l.price })),
          })
        ).id,
    );
  for (const r of pack.recipes)
    await one(
      'recipe',
      r.code,
      // An item that already has a recipe keeps it.
      async () =>
        (await db.recipe.findFirst({ where: { companyId, itemId: idOf(r.code), active: true } }))?.id,
      async (id) => Boolean(await db.recipe.count({ where: { id, companyId } })),
      async () => {
        await saveRecipe(db, actor, {
          itemId: idOf(r.code),
          outputQty: r.outputQty,
          lines: r.lines.map((l) => ({
            itemId: idOf(l.code),
            qty: l.qty,
            ...(l.unit ? { unit: l.unit } : {}),
          })),
        });
        return (
          await db.recipe.findFirstOrThrow({ where: { companyId, itemId: idOf(r.code), active: true } })
        ).id;
      },
    );
}
