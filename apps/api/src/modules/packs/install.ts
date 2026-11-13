import type { Db, Prisma } from '@mono/db';
import {
  checklistMasterSchema,
  fillTokens,
  libraryPack,
  packSchema,
  recordTypeInputSchema,
  reportInputSchema,
  type Pack,
  type PackKind,
  type PackMade,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { masterDefSchema, saveMaster } from '../ai/masters';
import { createMaster as createChecklist } from '../checklist/service';
import { createFlow, publishFlow, saveFlow } from '../fms/builder';
import { saveHosp } from '../hosp/settings';
import { createItem } from '../ims/items';
import { saveItemExtras } from '../ims/stock-items';
import { addValue } from '../lists/service';
import { saveRow } from '../masters/rows';
import { saveTaxRate } from '../money/taxes';
import { createType } from '../records/types';
import { saveReport } from '../reports/service';
import { can, type Actor } from '../work/actor';

/**
 * Phase 20 — installing a pack. Each thing the pack names is made once: what the company already has (by its
 * name, code or prefix) is taken over as it is and never changed; what a pack made earlier is left as the
 * company has it now. So an upgrade only adds what is new, two packs can share a master, and nothing a company
 * typed is ever overwritten. The same pack installed twice changes nothing.
 */
export const needPackAdmin = (actor: Actor) => {
  if (!can(actor, 'core.admin')) throw new AppError(403, 'FORBIDDEN', 'Only admins install packs');
};

export type InstallResult = {
  key: string;
  name: string;
  version: number;
  /** What this install made new, and what was already there (kept as it was). */
  made: { kind: PackKind; key: string }[];
  kept: { kind: PackKind; key: string }[];
  upgradedFrom: number | null;
};

export async function installPack(db: Db, actor: Actor, input: unknown): Promise<InstallResult> {
  needPackAdmin(actor);
  const parsed = packSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(400, 'VALIDATION_FAILED', 'This is not a pack file MONO can read', {
      problems: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  const pack: Pack = parsed.data;
  const companyId = actor.companyId;
  const before = await db.packInstall.findUnique({ where: { companyId_key: { companyId, key: pack.key } } });
  if (before && !before.removedAt && before.version > pack.version)
    throw new AppError(409, 'CONFLICT', `Version ${before.version} of this pack is already installed`);
  const had = ((before?.made ?? []) as PackMade[]).slice();
  const made: PackMade[] = [];
  const fresh: InstallResult['made'] = [];
  const kept: InstallResult['kept'] = [];
  // The built-in roles are every company's: a pack names them as @pack/role/builtin_hod, builtin_admin …
  const builtIn = new Map(
    (await db.role.findMany({ where: { companyId, deletedAt: null, key: { not: null } } })).map((r) => [
      `builtin_${r.key!.toLowerCase()}`,
      r.id,
    ]),
  );
  const ids = (kind: string, key: string) =>
    made.find((m) => m.kind === kind && m.key === key)?.id ??
    (kind === 'role' ? builtIn.get(key) : undefined);
  const fill = <T>(v: T) => {
    try {
      return fillTokens(v, ids, actor.userId);
    } catch (e) {
      throw new AppError(400, 'VALIDATION_FAILED', e instanceof Error ? e.message : 'The pack is broken');
    }
  };
  /** Make one thing unless the pack made it before (and it is still there) or the company already has it. */
  const one = async (
    kind: PackKind,
    key: string,
    find: () => Promise<string | null | undefined>,
    alive: (id: string) => Promise<boolean>,
    create: () => Promise<string>,
  ) => {
    const old = had.find((m) => m.kind === kind && m.key === key);
    if (old && (await alive(old.id))) {
      made.push(old);
      kept.push({ kind, key });
      return old.id;
    }
    const found = await find();
    if (found) {
      made.push({ kind, key, id: found, adopted: true });
      kept.push({ kind, key });
      return found;
    }
    const id = await create();
    made.push({ kind, key, id });
    fresh.push({ kind, key });
    return id;
  };

  if (pack.switches.hospitality) await saveHosp(db, actor, { enabled: true });

  for (const r of pack.roles)
    await one(
      'role',
      r.key,
      async () =>
        (
          await db.role.findFirst({
            where: { companyId, deletedAt: null, name: { equals: r.name, mode: 'insensitive' } },
          })
        )?.id,
      async (id) => Boolean(await db.role.count({ where: { id, companyId, deletedAt: null } })),
      async () =>
        (await db.role.create({ data: { companyId, name: r.name, permissions: r.permissions } })).id,
    );

  for (const t of pack.taxCodes)
    await one(
      'tax',
      t.code,
      async () => (await db.taxRate.findFirst({ where: { companyId, code: t.code } }))?.id,
      async (id) => Boolean(await db.taxRate.count({ where: { id, companyId } })),
      // A shell at 0 %: the rate is the accountant's to type (MONO ships no rates — decision 139).
      async () => {
        await saveTaxRate(db, actor, { code: t.code, name: t.name, percent: 0, from: '2000-01-01' });
        return (await db.taxRate.findFirstOrThrow({ where: { companyId, code: t.code } })).id;
      },
    );

  for (const l of pack.lists)
    for (const value of l.values) {
      const norm = value.trim().toLowerCase().replace(/\s+/g, ' ');
      const k = `${l.key}:${norm}`;
      await one(
        'list',
        k,
        async () =>
          (await db.valueList.findFirst({ where: { companyId, key: l.key, norm, deletedAt: null } }))?.id,
        async (id) => Boolean(await db.valueList.count({ where: { id, companyId, deletedAt: null } })),
        async () => (await addValue(db, actor, { key: l.key, value })).id,
      );
    }

  for (const m of pack.masters) {
    let isNew = false;
    const id = await one(
      'master',
      m.key,
      async () =>
        (
          await db.masterDef.findFirst({
            where: { companyId, deletedAt: null, name: { equals: m.name, mode: 'insensitive' } },
          })
        )?.id,
      async (x) => Boolean(await db.masterDef.count({ where: { id: x, companyId, deletedAt: null } })),
      async () => {
        isNew = true;
        const def = masterDefSchema.parse(
          fill({
            name: m.name,
            description: m.description,
            fields: m.fields,
            keyField: m.keyField,
            displayField: m.displayField,
          }),
        );
        return (await saveMaster(db, actor, def)).id;
      },
    );
    // A pack's rows go only into a master it has just made: a master the company already fills is its own.
    if (isNew) for (const row of m.rows) await saveRow(db, actor, id, fill(row));
  }

  for (const i of pack.items)
    await one(
      'item',
      i.code,
      async () =>
        (
          await db.item.findFirst({
            where: { companyId, deletedAt: null, code: { equals: i.code, mode: 'insensitive' } },
          })
        )?.id,
      async (id) => Boolean(await db.item.count({ where: { id, companyId, deletedAt: null } })),
      async () => {
        const item = await createItem(db, actor, {
          code: i.code,
          name: i.name,
          unit: i.unit,
          category: i.category ?? undefined,
        });
        if (Object.keys(i.extras).length) await saveItemExtras(db, actor, item.id, i.extras);
        return item.id;
      },
    );

  // Processes are made empty first so record types can point at them; their steps are saved once every id is known.
  const newFlows: string[] = [];
  for (const f of pack.flows)
    await one(
      'flow',
      f.key,
      async () =>
        (
          await db.flow.findFirst({
            where: { companyId, deletedAt: null, name: { equals: f.name, mode: 'insensitive' } },
          })
        )?.id,
      async (id) => Boolean(await db.flow.count({ where: { id, companyId, deletedAt: null } })),
      async () => {
        newFlows.push(f.key);
        return (
          await createFlow(db, actor, {
            name: f.name,
            runName: f.runName,
            departmentIds: [],
            description: f.description,
          })
        ).id;
      },
    );

  for (const t of pack.recordTypes)
    await one(
      'rt',
      t.key,
      async () =>
        (await db.recordType.findFirst({ where: { companyId, deletedAt: null, prefix: t.prefix } }))?.id,
      async (id) => Boolean(await db.recordType.count({ where: { id, companyId, deletedAt: null } })),
      async () => {
        const body = recordTypeInputSchema.safeParse(
          fill({
            name: t.name,
            pluralName: t.pluralName,
            prefix: t.prefix,
            description: t.description,
            definition: t.definition,
            // Its own section of the left menu, named after the pack.
            menu: { section: pack.name.slice(0, 30), icon: t.icon },
            ...(t.permissions ? { permissions: t.permissions } : {}),
          }),
        );
        if (!body.success)
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            `${t.name}: ${body.error.issues[0]?.message ?? 'cannot be read'}`,
          );
        return (await createType(db, actor, body.data)).id;
      },
    );

  for (const f of pack.flows.filter((x) => newFlows.includes(x.key))) {
    const id = ids('flow', f.key)!;
    await saveFlow(db, actor, id, { definition: fill(f.definition) });
    if (f.publish) await publishFlow(db, actor, id);
  }

  for (const c of pack.checklists)
    await one(
      'checklist',
      c.key,
      async () =>
        (
          await db.checklistMaster.findFirst({
            where: { companyId, deletedAt: null, name: { equals: c.name, mode: 'insensitive' } },
          })
        )?.id,
      async (id) => Boolean(await db.checklistMaster.count({ where: { id, companyId, deletedAt: null } })),
      async () => {
        const body = checklistMasterSchema.parse(fill({ doerIds: [actor.userId], ...c.input, name: c.name }));
        return (await db.$transaction((tx) => createChecklist(tx, actor, body))).id;
      },
    );

  for (const r of pack.reports)
    await one(
      'report',
      r.key,
      async () =>
        (
          await db.report.findFirst({
            where: { companyId, deletedAt: null, name: { equals: r.name, mode: 'insensitive' } },
          })
        )?.id,
      async (id) => Boolean(await db.report.count({ where: { id, companyId, deletedAt: null } })),
      async () =>
        (
          await saveReport(
            db,
            actor,
            reportInputSchema.parse(fill({ name: r.name, definition: r.definition })),
          )
        ).id,
    );

  const data = {
    name: pack.name,
    version: pack.version,
    industry: pack.industry,
    // What an earlier version made and this one no longer names stays on the list: it is still the pack's.
    made: [
      ...made,
      ...had.filter((h) => !made.some((m) => m.kind === h.kind && m.key === h.key)),
    ] as unknown as Prisma.InputJsonValue,
    words: pack.words as Prisma.InputJsonValue,
    removedAt: null,
  };
  await db.$transaction(async (tx) => {
    const row = before
      ? await tx.packInstall.update({ where: { id: before.id }, data })
      : await tx.packInstall.create({
          data: { ...data, companyId, key: pack.key, installedById: actor.userId },
        });
    await writeAudit(
      tx,
      { companyId, actorId: actor.userId },
      {
        action: before && !before.removedAt ? 'pack.upgraded' : 'pack.installed',
        entityType: 'pack',
        entityId: row.id,
        before: before ? { version: before.version } : undefined,
        after: { key: pack.key, version: pack.version, made: fresh.length, kept: kept.length },
      },
    );
  });
  return {
    key: pack.key,
    name: pack.name,
    version: pack.version,
    made: fresh,
    kept,
    upgradedFrom: before && !before.removedAt ? before.version : null,
  };
}

/** Install one of the packs MONO ships. */
export async function installLibraryPack(db: Db, actor: Actor, key: string) {
  const pack = libraryPack(key);
  if (!pack) throw notFound('Pack');
  return installPack(db, actor, pack);
}
