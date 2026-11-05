import type { Db } from '@mono/db';
import { fieldSchema } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';

/** A master definition (CLAUDE.md §8). Rows, Excel import and the library come in phase 10. */
export const masterDefSchema = z.object({
  name: z.string().trim().min(2, 'Name the master').max(80),
  description: z.string().trim().max(300).nullish(),
  fields: z.array(fieldSchema).min(1, 'Add at least one field').max(60),
  keyField: z.string().max(40).nullish(),
  displayField: z.string().max(40).nullish(),
  source: z.enum(['ai', 'own', 'library']).default('own'),
});
export type MasterDefInput = z.infer<typeof masterDefSchema>;

export async function listMasters(db: Db, companyId: string) {
  return db.masterDef.findMany({ where: { companyId, deletedAt: null }, orderBy: { name: 'asc' } });
}

export async function saveMaster(db: Db, actor: Actor, input: MasterDefInput, id?: string) {
  const keys = new Set(input.fields.map((f) => f.key));
  if (keys.size !== input.fields.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Two fields have the same key');
  for (const k of [input.keyField, input.displayField])
    if (k && !keys.has(k)) throw new AppError(400, 'VALIDATION_FAILED', `There is no field "${k}"`);
  return db.$transaction(async (tx) => {
    const clash = await tx.masterDef.findFirst({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        name: { equals: input.name, mode: 'insensitive' },
        NOT: id ? { id } : undefined,
      },
    });
    if (clash) throw new AppError(409, 'CONFLICT', `There is already a master called "${clash.name}"`);
    const data = {
      name: input.name,
      description: input.description ?? null,
      fields: input.fields as object,
      keyField: input.keyField ?? null,
      displayField: input.displayField ?? null,
      source: input.source,
    };
    const before = id
      ? await tx.masterDef.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } })
      : null;
    if (id && !before) throw notFound('Master');
    const row = id
      ? await tx.masterDef.update({ where: { id }, data })
      : await tx.masterDef.create({
          data: { ...data, companyId: actor.companyId, createdById: actor.userId },
        });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: id ? 'master.edited' : 'master.created',
        entityType: 'master',
        entityId: row.id,
        before,
        after: row,
      },
    );
    return row;
  });
}

export async function deleteMaster(db: Db, actor: Actor, id: string) {
  const row = await db.masterDef.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!row) throw notFound('Master');
  await db.$transaction(async (tx) => {
    await tx.masterDef.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'master.deleted', entityType: 'master', entityId: id, before: row },
    );
  });
  return { ok: true };
}
