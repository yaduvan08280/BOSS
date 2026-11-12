import type { Db, Item, Tx } from '@mono/db';
import type { ItemLine } from '@mono/shared';
import type { FormStage } from '../forms';

/** One item line as it arrives (a form sends text; a stored line holds numbers). */
export type RawLine = { item?: unknown; qty?: unknown; rate?: unknown; itemId?: unknown; unit?: unknown };

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase();

/**
 * Find the items a set of lines talk about, in one query: by the id a picked line keeps, else by the text —
 * the item's code first, then its name. Only active items of this company are ever found.
 */
export async function itemResolver(db: Db | Tx, companyId: string, lines: RawLine[]) {
  const ids = [
    ...new Set(lines.map((l) => l.itemId).filter((x): x is string => typeof x === 'string' && !!x)),
  ];
  const texts = [...new Set(lines.map((l) => String(l.item ?? '').trim()).filter(Boolean))];
  const items: Item[] =
    ids.length || texts.length
      ? await db.item.findMany({
          where: {
            companyId,
            deletedAt: null,
            active: true,
            OR: [
              ...(ids.length ? [{ id: { in: ids } }] : []),
              ...texts.flatMap((t) => [
                { code: { equals: t, mode: 'insensitive' as const } },
                { name: { equals: t, mode: 'insensitive' as const } },
              ]),
            ],
          },
          orderBy: { code: 'asc' },
        })
      : [];
  const byId = (id: unknown) => (typeof id === 'string' ? (items.find((i) => i.id === id) ?? null) : null);
  const byText = (text: unknown) => {
    const k = norm(text);
    if (!k) return null;
    return items.find((i) => norm(i.code) === k) ?? items.find((i) => norm(i.name) === k) ?? null;
  };
  return { byId, byText, find: (l: RawLine) => byId(l.itemId) ?? byText(l.item) };
}

/**
 * May a line be typed by hand (not picked from the item master)?
 * - `freeItems: true` — yes. `freeItems: false` — no (what the builder sets on every new "items" field).
 * - no setting — the field was made before phase 11 (or by a flow MONO builds itself, like the CRM's after-order
 *   flow): it keeps accepting typed lines, exactly as it did.
 * - the public form — yes: an outside visitor has no item list to pick from.
 */
export const typedLinesAllowed = (field: { freeItems?: boolean }, publicForm?: boolean) =>
  field.freeItems !== false || Boolean(publicForm);

/**
 * Item lines (L14). A picked line must point at an active item of this company; it then reads as the master
 * does (name, unit). A typed line is linked when its text is an item's code or name; one that matches nothing is
 * refused unless the field allows typed items.
 */
export const itemLinesStage: FormStage = {
  name: 'items',
  async check(db, scope, fields, state) {
    for (const f of fields) {
      if (f.type !== 'items' || state.errors[f.key]) continue;
      const lines = state.values[f.key] as ItemLine[] | undefined;
      if (!Array.isArray(lines) || !lines.length) continue;
      const items = await itemResolver(db, scope.companyId, lines);
      const free = typedLinesAllowed(f, scope.publicForm);
      const out: ItemLine[] = [];
      for (const l of lines) {
        const { itemId: _id, unit: typedUnit, ...line } = l;
        const picked = l.itemId ? items.byId(l.itemId) : null;
        if (l.itemId && !picked) {
          state.errors[f.key] = `${f.label}: "${l.item}" is no longer in the item list — pick it again`;
          break;
        }
        const item = picked ?? items.byText(l.item);
        if (!item) {
          if (!free) {
            state.errors[f.key] =
              `${f.label}: "${l.item}" is not in the item master — pick an item from the list`;
            break;
          }
          out.push({ ...line, ...(typedUnit ? { unit: typedUnit } : {}) });
          continue;
        }
        // Picked (or a field that takes only items): the line reads as the master does. Typed on a free field: as typed.
        out.push({ ...line, item: picked || !free ? item.name : l.item, itemId: item.id, unit: item.unit });
      }
      if (!state.errors[f.key]) state.values[f.key] = out;
    }
  },
};
