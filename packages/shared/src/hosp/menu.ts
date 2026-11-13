import { z } from 'zod';

/**
 * Phase 14 — the menu (shared schemas and pure rules): categories, items with variants, modifier groups, combos,
 * prices per outlet and time band, availability windows, and "86" (out of stock).
 */
const name = z.string().trim().min(1).max(80);
const paise = z.number().int().min(0).max(1e13);
const minute = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);
const key = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,29}$/);

export const DIETS = ['VEG', 'NONVEG', 'EGG'] as const;
export type Diet = (typeof DIETS)[number];

/** A time window on some weekdays (1 = Monday … 7 = Sunday; none listed = every day). May cross midnight. */
export const windowSchema = z.object({
  fromMin: minute,
  toMin: minute,
  days: z.array(z.number().int().min(1).max(7)).max(7).default([]),
});
export type TimeWindow = z.infer<typeof windowSchema>;

export const variantSchema = z.object({
  key,
  name,
  price: paise,
  /** The stock item (a dish with its own recipe) this variant uses; left out, the item's own × factor. */
  itemId: z.string().nullish(),
  /** How much of the item's recipe this variant uses (half = 0.5). */
  factor: z.number().positive().max(100).default(1),
});
export type Variant = z.infer<typeof variantSchema>;

export const modifierOptionSchema = z.object({
  key,
  name,
  price: paise.default(0),
  /** Stock effect: this much of a stock item leaves with the dish (extra cheese 20 g). */
  itemId: z.string().nullish(),
  qty: z.number().positive().max(1e6).nullish(),
  unit: z.string().trim().max(12).nullish(),
});
export const modifierGroupSchema = z.object({
  name,
  /** How many options a guest must / may pick. */
  min: z.number().int().min(0).max(20).default(0),
  max: z.number().int().min(1).max(20).default(1),
  options: z.array(modifierOptionSchema).min(1).max(40),
});
export type ModifierGroupInput = z.infer<typeof modifierGroupSchema>;

export const menuCategorySchema = z.object({
  name,
  nameHi: z.string().trim().max(80).nullish(),
  sort: z.number().int().min(0).max(9999).default(0),
});

export const menuItemSchema = z.object({
  categoryId: z.string().min(1),
  name,
  nameHi: z.string().trim().max(80).nullish(),
  code: z.string().trim().max(20).nullish(),
  /** The stock item this sells (a dish with a recipe, or a stocked item sold as it is). */
  itemId: z.string().nullish(),
  diet: z.enum(DIETS).default('VEG'),
  allergens: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  spice: z.number().int().min(0).max(3).default(0),
  photoId: z.string().nullish(),
  hsn: z.string().trim().max(12).nullish(),
  taxCode: z.string().trim().max(20).nullish(),
  price: paise,
  variants: z.array(variantSchema).max(12).default([]),
  modifierGroupIds: z.array(z.string()).max(12).default([]),
  /** A combo: these menu items, sold together at this item's price. */
  combo: z
    .array(z.object({ menuItemId: z.string(), qty: z.number().positive().max(100).default(1) }))
    .max(12)
    .default([]),
  /** When it can be ordered (breakfast 07:00–10:30); none = always. */
  windows: z.array(windowSchema).max(8).default([]),
  /** The outlets that sell it; none = every outlet. */
  outletIds: z.array(z.string()).max(50).default([]),
  active: z.boolean().default(true),
});
export type MenuItemInput = z.infer<typeof menuItemSchema>;

/** A price that differs at an outlet and / or in a time band (happy hour 17:00–19:00). */
export const menuPriceSchema = z.object({
  menuItemId: z.string().min(1),
  variantKey: z.string().default(''),
  outletId: z.string().nullish(),
  label: z.string().trim().max(40).nullish(),
  window: windowSchema.nullish(),
  price: paise,
});
export type MenuPriceLite = {
  variantKey: string;
  outletId: string | null;
  window: TimeWindow | null;
  price: number;
  label?: string | null;
};

const inWindow = (w: TimeWindow, minuteOfDay: number, weekday: number) => {
  const prev = weekday === 1 ? 7 : weekday - 1;
  const day = (d: number) => !w.days.length || w.days.includes(d);
  if (w.fromMin <= w.toMin) return day(weekday) && minuteOfDay >= w.fromMin && minuteOfDay < w.toMin;
  // Across midnight: the late part belongs to the day it started on.
  return (day(weekday) && minuteOfDay >= w.fromMin) || (day(prev) && minuteOfDay < w.toMin);
};
/** Can it be ordered now? No windows = always. */
export const availableAt = (windows: TimeWindow[], minuteOfDay: number, weekday: number) =>
  !windows.length || windows.some((w) => inWindow(w, minuteOfDay, weekday));

/**
 * The price of an item (or one of its variants) at an outlet at a time: a price for this outlet in a time band
 * that is running, then a band for every outlet, then this outlet's own price, then the menu price.
 */
export function priceAt(
  base: number,
  prices: MenuPriceLite[],
  ask: { variantKey?: string; outletId: string | null; minuteOfDay: number; weekday: number },
): { price: number; label: string | null } {
  const fits = prices
    .filter(
      (p) =>
        p.variantKey === (ask.variantKey ?? '') &&
        (!p.outletId || p.outletId === ask.outletId) &&
        (!p.window || inWindow(p.window, ask.minuteOfDay, ask.weekday)),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.window)) - Number(Boolean(a.window)) ||
        Number(Boolean(b.outletId)) - Number(Boolean(a.outletId)),
    );
  const best = fits[0];
  return best ? { price: best.price, label: best.label ?? null } : { price: base, label: null };
}

/** One pasted line of a menu: "Starters, Paneer tikka, 320, veg, Half=180|Full=320". */
export type MenuImportRow = {
  line: number;
  category: string;
  name: string;
  price: number;
  diet: Diet;
  variants: { name: string; price: number }[];
};
export function parseMenuRows(text: string): {
  rows: MenuImportRow[];
  problems: { line: number; message: string }[];
} {
  const rows: MenuImportRow[] = [];
  const problems: { line: number; message: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const cells = raw.split(raw.includes('\t') ? '\t' : ',').map((c) => c.trim());
    const [category, itemName, price, diet, variants] = cells;
    if (i === 0 && /^categor/i.test(category ?? '')) return;
    if (!category || !itemName) return void problems.push({ line, message: 'Needs a category and a name' });
    const amount = Number(price);
    if (price === undefined || price === '' || Number.isNaN(amount) || amount < 0)
      return void problems.push({ line, message: `"${price ?? ''}" is not a price` });
    const d = (diet ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const dietKey: Diet = d.startsWith('non') ? 'NONVEG' : d.startsWith('egg') ? 'EGG' : 'VEG';
    const vs: { name: string; price: number }[] = [];
    for (const part of (variants ?? '')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean)) {
      const [vn, vp] = part.split('=').map((x) => x.trim());
      if (!vn || vp === undefined || Number.isNaN(Number(vp)))
        return void problems.push({ line, message: `"${part}" is not a variant (use Half=180)` });
      vs.push({ name: vn, price: Math.round(Number(vp) * 100) });
    }
    rows.push({
      line,
      category,
      name: itemName,
      price: Math.round(amount * 100),
      diet: dietKey,
      variants: vs,
    });
  });
  return { rows, problems };
}
