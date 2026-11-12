import { Prisma, type Db, type Tx } from '@mono/db';
import {
  checkRecordDefinition,
  EVERYONE,
  RECORD_RIGHTS,
  recordTypeMachine,
  riskyChanges,
  transition,
  type DefinitionChange,
  type RecordDefinition,
  type RecordPermissions,
  type RecordTypeInput,
  type RecordTypePatch,
} from '@mono/shared';
import { AppError } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { can, type Actor } from '../work/actor';
import { ctxOf, loadType, roleIdOf, shapeType, type LoadedType } from './access';
import { checkStartFlows, startableFlows } from './start-flow';

const needAdmin = (actor: Actor) => {
  if (!can(actor, 'records.admin')) throw new AppError(403, 'FORBIDDEN', 'Only admins set up record types');
};

/** What a screen needs of a type. `permissions` (who may do what) is only shown to the people who set it up. */
export function typeView(t: LoadedType, extra: { records?: number } = {}) {
  return {
    id: t.id,
    name: t.name,
    pluralName: t.pluralName,
    code: t.code,
    prefix: t.prefix,
    description: t.description,
    status: t.status,
    definition: t.def,
    menu: t.menu,
    access: t.access,
    ...(t.access.admin ? { permissions: t.permissions } : {}),
    updatedAt: t.updatedAt,
    ...extra,
  };
}

/** Everyone views, makes and edits; heads of department approve. */
async function defaultPermissions(db: Db | Tx, companyId: string): Promise<RecordPermissions> {
  const hod = await db.role.findFirst({ where: { companyId, key: 'HOD', deletedAt: null } });
  return { view: [EVERYONE], create: [EVERYONE], edit: [EVERYONE], approve: hod ? [hod.id] : [] };
}

/** Roles named in the permissions and in the moves must be roles of this company. */
async function checkRoles(db: Db | Tx, companyId: string, p: RecordPermissions, def: RecordDefinition) {
  const named = new Set<string>();
  for (const right of RECORD_RIGHTS) for (const r of p[right]) if (r !== EVERYONE) named.add(r);
  for (const m of def.moves) for (const w of m.who) if (w.startsWith('role:')) named.add(w.slice(5));
  if (!named.size) return;
  const found = await db.role.findMany({
    where: { companyId, deletedAt: null, id: { in: [...named] } },
    select: { id: true },
  });
  if (found.length !== named.size)
    throw new AppError(400, 'VALIDATION_FAILED', 'A role chosen here does not exist any more: pick again');
}

function refuseProblems(def: RecordDefinition) {
  const problems = checkRecordDefinition(def);
  if (problems.length) throw new AppError(400, 'VALIDATION_FAILED', problems[0]!, { problems });
}

/** A short name for links and the API, made from the name: "Site visit" → "site_visit" (then _2, _3 …). */
async function freeCode(db: Db | Tx, companyId: string, name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'record';
  const start = /^[a-z]/.test(base) ? base : `r_${base}`;
  for (let n = 1; ; n++) {
    const code = n === 1 ? start : `${start}_${n}`;
    if (!(await db.recordType.findFirst({ where: { companyId, code }, select: { id: true } }))) return code;
  }
}

async function prefixFree(db: Db | Tx, companyId: string, prefix: string, notId?: string) {
  const clash = await db.recordType.findFirst({
    where: { companyId, prefix, deletedAt: null, ...(notId ? { id: { not: notId } } : {}) },
  });
  if (clash)
    throw new AppError(
      409,
      'CONFLICT',
      `"${prefix}" already numbers ${clash.pluralName.toLowerCase()}: choose another prefix`,
    );
}

async function nameFree(db: Db | Tx, companyId: string, name: string, notId?: string) {
  const clash = await db.recordType.findFirst({
    where: {
      companyId,
      deletedAt: null,
      name: { equals: name, mode: 'insensitive' },
      ...(notId ? { id: { not: notId } } : {}),
    },
  });
  if (clash) throw new AppError(409, 'CONFLICT', `There is already a record type called "${clash.name}"`);
}

const liveCount = (db: Db | Tx, typeId: string) =>
  db.recordEntry.count({ where: { typeId, deletedAt: null } });

/** The record types this person may see (admins: every one, archived too), each with its number of records. */
export async function listTypes(db: Db, actor: Actor) {
  const [rows, roleId, counts] = await Promise.all([
    db.recordType.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      orderBy: { name: 'asc' },
    }),
    roleIdOf(db, actor),
    db.recordEntry.groupBy({
      by: ['typeId'],
      where: { companyId: actor.companyId, deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  const count = new Map(counts.map((c) => [c.typeId, c._count._all]));
  const types = rows
    .map((r) => shapeType(r, actor, roleId))
    .filter((t) => t.access.admin || (t.access.view && t.status === 'ACTIVE'));
  return {
    types: types.map((t) => typeView(t, { records: count.get(t.id) ?? 0 })),
    canAdmin: can(actor, 'records.admin'),
  };
}

export async function readType(db: Db, actor: Actor, id: string) {
  const t = await loadType(db, actor, id, 'view');
  return typeView(t, { records: await liveCount(db, id) });
}

export async function createType(db: Db, actor: Actor, input: RecordTypeInput) {
  needAdmin(actor);
  refuseProblems(input.definition);
  await checkStartFlows(db, actor.companyId, input.definition);
  const permissions = input.permissions ?? (await defaultPermissions(db, actor.companyId));
  await checkRoles(db, actor.companyId, permissions, input.definition);
  await nameFree(db, actor.companyId, input.name);
  await prefixFree(db, actor.companyId, input.prefix);
  return db.$transaction(async (tx) => {
    const row = await tx.recordType.create({
      data: {
        companyId: actor.companyId,
        name: input.name,
        pluralName: input.pluralName,
        code: await freeCode(tx, actor.companyId, input.name),
        prefix: input.prefix,
        description: input.description ?? null,
        definition: input.definition as object,
        menu: input.menu as object,
        permissions: permissions as object,
        createdById: actor.userId,
      },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'record_type.created',
      entityType: 'record_type',
      entityId: row.id,
      after: { name: row.name, prefix: row.prefix, definition: input.definition, permissions },
      payload: { typeId: row.id, name: row.name, code: row.code },
    });
    return { id: row.id, code: row.code };
  });
}

/** How many live records hold what a change would take away. JSON keys are bound values, never SQL text. */
async function heldBy(db: Db | Tx, typeId: string, c: DefinitionChange): Promise<number> {
  const count = async (cond: Prisma.Sql) => {
    const rows = await db.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*) AS n FROM records WHERE type_id = ${typeId} AND deleted_at IS NULL AND ${cond}`,
    );
    return Number(rows[0]?.n ?? 0);
  };
  if (c.kind === 'statusRemoved') return count(Prisma.sql`status = ${c.key}`);
  if (c.kind === 'tableRemoved')
    return count(
      Prisma.sql`jsonb_typeof(lines -> ${c.key}) = 'array' AND jsonb_array_length(lines -> ${c.key}) > 0`,
    );
  if (c.table)
    return count(
      Prisma.sql`jsonb_typeof(lines -> ${c.table}) = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(lines -> ${c.table}) row
        WHERE coalesce(row ->> ${c.key}, '') NOT IN ('', '[]'))`,
    );
  return count(Prisma.sql`coalesce(data ->> ${c.key}, '') NOT IN ('', '[]')`);
}

/** Say why a change can't be made, in the words of the person setting the type up. */
function refusal(t: LoadedType, c: DefinitionChange, n: number): string {
  const many = `${n} ${(n === 1 ? t.name : t.pluralName).toLowerCase()}`;
  const where = 'table' in c && c.table ? ` (in the table "${c.table}")` : '';
  switch (c.kind) {
    case 'fieldRemoved':
      return `"${c.label}"${where} is filled in ${many}: it can't be removed or given a new key, or that information would be lost`;
    case 'fieldType':
      return `"${c.label}"${where} is filled in ${many}: its type can't change from ${c.from} to ${c.to}, because the saved values would not fit`;
    case 'tableRemoved':
      return `The table "${c.label}" has lines in ${many}: it can't be removed`;
    case 'statusRemoved':
      return `${many} ${n === 1 ? 'is' : 'are'} in the status "${c.label}": move ${n === 1 ? 'it' : 'them'} to another status before removing it`;
  }
}

/**
 * Change a type. Nothing destructive is allowed once records exist: a field (or its key / type), a table or a
 * status that records still hold can't go — the answer names what holds it. Everything else changes freely.
 */
export async function updateType(db: Db, actor: Actor, id: string, patch: RecordTypePatch) {
  const t = await loadType(db, actor, id, 'admin');
  const def = patch.definition ?? t.def;
  const permissions = patch.permissions ?? t.permissions;
  if (patch.definition) {
    refuseProblems(def);
    await checkStartFlows(db, actor.companyId, def);
    const refused: string[] = [];
    for (const c of riskyChanges(t.def, def)) {
      const n = await heldBy(db, id, c);
      if (n) refused.push(refusal(t, c, n));
    }
    if (refused.length) throw new AppError(409, 'CONFLICT', refused[0]!, { problems: refused });
  }
  if (patch.definition || patch.permissions) await checkRoles(db, actor.companyId, permissions, def);
  if (patch.name && patch.name !== t.name) await nameFree(db, actor.companyId, patch.name, id);
  if (patch.prefix && patch.prefix !== t.prefix) await prefixFree(db, actor.companyId, patch.prefix, id);
  return db.$transaction(async (tx) => {
    const row = await tx.recordType.update({
      where: { id },
      data: {
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.pluralName ? { pluralName: patch.pluralName } : {}),
        ...(patch.prefix ? { prefix: patch.prefix } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.definition ? { definition: def as object } : {}),
        ...(patch.menu ? { menu: patch.menu as object } : {}),
        ...(patch.permissions ? { permissions: permissions as object } : {}),
      },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'record_type.changed',
      entityType: 'record_type',
      entityId: id,
      before: { name: t.name, prefix: t.prefix, definition: t.def, menu: t.menu, permissions: t.permissions },
      after: { name: row.name, prefix: row.prefix, definition: def, menu: row.menu, permissions },
      payload: { typeId: id, name: row.name, code: row.code, changed: Object.keys(patch) },
    });
    return { id };
  });
}

/** Archive (kept with its records, no new ones, off the menu) or bring back — through the shared machine. */
export async function setTypeStatus(db: Db, actor: Actor, id: string, action: 'archive' | 'restore') {
  const t = await loadType(db, actor, id, 'admin');
  const { to } = transition(recordTypeMachine, { from: t.status, action, roles: ['admin'], ctx: {} });
  await db.$transaction(async (tx) => {
    await tx.recordType.update({ where: { id }, data: { status: to } });
    await recordChange(tx, ctxOf(actor), {
      event: action === 'archive' ? 'record_type.archived' : 'record_type.restored',
      entityType: 'record_type',
      entityId: id,
      before: { status: t.status },
      after: { status: to },
      payload: { typeId: id, name: t.name, status: to },
    });
  });
  return { id, status: to };
}

/** Delete a type nobody used (decision 8). One with records is archived instead. */
export async function deleteType(db: Db, actor: Actor, id: string) {
  const t = await loadType(db, actor, id, 'admin');
  const n = await liveCount(db, id);
  if (n)
    throw new AppError(
      409,
      'CONFLICT',
      `${t.pluralName} hold ${n} record${n === 1 ? '' : 's'}: archive the type instead of deleting it`,
    );
  await db.$transaction(async (tx) => {
    // The code and the prefix are freed for a new type; the row stays as history.
    await tx.recordType.update({ where: { id }, data: { deletedAt: new Date(), code: null } });
    await recordChange(tx, ctxOf(actor), {
      event: 'record_type.deleted',
      entityType: 'record_type',
      entityId: id,
      before: { name: t.name, prefix: t.prefix },
      payload: { typeId: id, name: t.name },
    });
  });
  return { ok: true };
}

/** The left-menu entries of the signed-in person: active types with a place in the menu that they may see. */
export async function menuEntries(db: Db, actor: Actor) {
  const [rows, roleId] = await Promise.all([
    db.recordType.findMany({
      where: { companyId: actor.companyId, deletedAt: null, status: 'ACTIVE' },
      orderBy: { pluralName: 'asc' },
    }),
    roleIdOf(db, actor),
  ]);
  return rows
    .map((r) => shapeType(r, actor, roleId))
    .filter((t) => t.access.view && t.menu.section)
    .map((t) => ({
      id: t.id,
      name: t.pluralName,
      section: t.menu.section!,
      icon: t.menu.icon,
      path: `/records/${t.id}`,
    }));
}

/** Published processes a move can start, with their start fields — for the people who set record types up. */
export async function flowsToStart(db: Db, actor: Actor) {
  needAdmin(actor);
  return startableFlows(db, actor.companyId);
}
