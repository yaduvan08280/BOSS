import type { Db, Tx } from '@mono/db';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';

export const attributeDefSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,29}$/),
  label: z.string().trim().min(1).max(40),
  type: z.enum(['text', 'number', 'choice']),
  options: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
});
export const attributesSchema = z.object({
  category: z.string().trim().min(1).max(60),
  defs: z.array(attributeDefSchema).max(12),
});
export type AttributeDef = z.infer<typeof attributeDefSchema>;

export async function listAttributes(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see stock");
  const rows = await db.itemAttribute.findMany({
    where: { companyId: actor.companyId },
    orderBy: { category: 'asc' },
  });
  return rows.map((r) => ({ category: r.category, defs: r.defs as AttributeDef[] }));
}
/** The attributes a category's lots and pieces carry (size, colour, grade, purity …). */
export async function saveAttributes(db: Db, actor: Actor, input: z.input<typeof attributesSchema>) {
  need(actor, 'ims.admin', 'Only inventory admins set attributes');
  const a = attributesSchema.parse(input);
  if (new Set(a.defs.map((d) => d.key)).size !== a.defs.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Each attribute key can be used once');
  await db.$transaction(async (tx) => {
    await tx.itemAttribute.upsert({
      where: { companyId_category: { companyId: actor.companyId, category: a.category } },
      create: { companyId: actor.companyId, category: a.category, defs: a.defs },
      update: { defs: a.defs },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.attributes_saved',
      entityType: 'item_attribute',
      entityId: a.category,
      after: a,
    });
  });
  return listAttributes(db, actor);
}
/** Check a lot's or piece's attributes against its category: unknown keys, wrong numbers and choices are refused. */
export async function checkAttrs(db: Db | Tx, companyId: string, category: string | null, attrs: unknown) {
  if (attrs === null || attrs === undefined) return null;
  const given = attrs as Record<string, unknown>;
  const row = category
    ? await db.itemAttribute.findUnique({ where: { companyId_category: { companyId, category } } })
    : null;
  const defs = new Map(((row?.defs as AttributeDef[] | undefined) ?? []).map((d) => [d.key, d]));
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(given)) {
    const d = defs.get(k);
    if (!d)
      throw new AppError(400, 'VALIDATION_FAILED', `${k} is not an attribute of ${category ?? 'this item'}`);
    if (v === '' || v === null || v === undefined) continue;
    if (d.type === 'number') {
      if (Number.isNaN(Number(v)))
        throw new AppError(400, 'VALIDATION_FAILED', `${d.label} must be a number`);
      out[k] = Number(v);
    } else {
      if (d.type === 'choice' && d.options?.length && !d.options.includes(String(v)))
        throw new AppError(400, 'VALIDATION_FAILED', `${d.label} must be one of: ${d.options.join(', ')}`);
      out[k] = String(v);
    }
  }
  return out;
}
