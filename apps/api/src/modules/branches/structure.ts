import type { Db, Tx } from '@mono/db';
import {
  localDate,
  type EntityInput,
  type LocationInput,
  type ManagersInput,
  type RegionInput,
} from '@mono/shared';
import { recordMove } from './history';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { can, type Actor } from '../work/actor';

const ctxOf = (a: Actor) => ({ companyId: a.companyId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });
/** The structure is the group's: owner and group admins set it up. */
const needEdit = (a: Actor) => {
  if (!can(a, 'org.edit')) throw new AppError(403, 'FORBIDDEN', "You can't change the company's structure");
};
const live = (companyId: string) => ({ companyId, deletedAt: null });

/** Everything of the structure in one read: entities, regions, branches with their managers and locations. */
export async function structure(db: Db, actor: Actor) {
  const where = live(actor.companyId);
  const [entities, regions, branches, locations, managers, people] = await Promise.all([
    db.legalEntity.findMany({ where, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    db.region.findMany({ where, orderBy: { name: 'asc' } }),
    db.branch.findMany({ where, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    db.location.findMany({ where, orderBy: { name: 'asc' } }),
    db.branchManager.findMany({ where: { companyId: actor.companyId } }),
    db.user.groupBy({
      by: ['branchId'],
      where: { ...where, branchId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const count = new Map(people.map((p) => [p.branchId, p._count._all]));
  return {
    entities,
    regions,
    branches: branches.map((b) => ({ ...b, people: count.get(b.id) ?? 0 })),
    locations,
    managers: managers.map((m) => ({
      userId: m.userId,
      branchId: m.branchId,
      regionId: m.regionId,
      role: m.role,
    })),
  };
}

/** A row of this company, or a 404 that names what is missing. */
async function mustExist(
  tx: Tx,
  companyId: string,
  what: 'entity' | 'region' | 'branch',
  id: string | null | undefined,
) {
  if (!id) return;
  const where = { id, companyId, deletedAt: null };
  const found =
    what === 'entity'
      ? await tx.legalEntity.count({ where })
      : what === 'region'
        ? await tx.region.count({ where })
        : await tx.branch.count({ where });
  if (!found) throw notFound(what === 'entity' ? 'Legal entity' : what === 'region' ? 'Region' : 'Branch');
}

export async function saveEntity(db: Db, actor: Actor, input: EntityInput, id?: string) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    const before = id ? await tx.legalEntity.findFirst({ where: { id, ...live(actor.companyId) } }) : null;
    if (id && !before) throw notFound('Legal entity');
    const clash = await tx.legalEntity.findFirst({
      where: {
        ...live(actor.companyId),
        name: { equals: input.name, mode: 'insensitive' },
        ...(id ? { NOT: { id } } : {}),
      },
    });
    if (clash) throw new AppError(409, 'CONFLICT', `There is already an entity called "${clash.name}"`);
    const first = !id && (await tx.legalEntity.count({ where: live(actor.companyId) })) === 0;
    if (input.isDefault)
      await tx.legalEntity.updateMany({ where: { companyId: actor.companyId }, data: { isDefault: false } });
    const data = {
      name: input.name,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.country ? { country: input.country } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.state !== undefined ? { state: input.state || null } : {}),
      ...(input.taxId !== undefined ? { taxId: input.taxId || null } : {}),
      ...(input.isDefault || first ? { isDefault: true } : {}),
      ...(input.details ? { details: input.details as object } : {}),
    };
    const row = before
      ? await tx.legalEntity.update({ where: { id: before.id }, data })
      : await tx.legalEntity.create({ data: { ...data, companyId: actor.companyId } });
    await recordChange(tx, ctxOf(actor), {
      event: before ? 'entity.updated' : 'entity.created',
      entityType: 'legal_entity',
      entityId: row.id,
      before: before ?? undefined,
      after: row,
    });
    return row;
  });
}

export async function deleteEntity(db: Db, actor: Actor, id: string) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    const before = await tx.legalEntity.findFirst({ where: { id, ...live(actor.companyId) } });
    if (!before) throw notFound('Legal entity');
    const branches = await tx.branch.count({ where: { ...live(actor.companyId), entityId: id } });
    if (branches)
      throw new AppError(
        409,
        'CONFLICT',
        `${branches} branch(es) still belong to this entity: move them first`,
      );
    await tx.legalEntity.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
    await tx.region.updateMany({
      where: { companyId: actor.companyId, entityId: id },
      data: { deletedAt: new Date() },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'entity.deleted',
      entityType: 'legal_entity',
      entityId: id,
      before,
    });
    return { ok: true };
  });
}

export async function saveRegion(db: Db, actor: Actor, input: RegionInput, id?: string) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    const before = id ? await tx.region.findFirst({ where: { id, ...live(actor.companyId) } }) : null;
    if (id && !before) throw notFound('Region');
    await mustExist(tx, actor.companyId, 'entity', input.entityId);
    // A region can't sit under itself, however deep.
    for (let cursor = input.parentId ?? null, depth = 0; cursor && depth < 50; depth++) {
      if (cursor === id) throw new AppError(400, 'VALIDATION_FAILED', 'A region cannot sit under itself');
      const parent: { parentId: string | null } | null = await tx.region.findFirst({
        where: { id: cursor, ...live(actor.companyId) },
        select: { parentId: true },
      });
      if (!parent) throw notFound('Parent region');
      cursor = parent.parentId;
    }
    const data = { name: input.name, entityId: input.entityId ?? null, parentId: input.parentId ?? null };
    const row = before
      ? await tx.region.update({ where: { id: before.id }, data })
      : await tx.region.create({ data: { ...data, companyId: actor.companyId } });
    await recordChange(tx, ctxOf(actor), {
      event: before ? 'region.updated' : 'region.created',
      entityType: 'region',
      entityId: row.id,
      before: before ?? undefined,
      after: row,
    });
    return row;
  });
}

export async function deleteRegion(db: Db, actor: Actor, id: string) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    const before = await tx.region.findFirst({ where: { id, ...live(actor.companyId) } });
    if (!before) throw notFound('Region');
    const [branches, children] = await Promise.all([
      tx.branch.count({ where: { ...live(actor.companyId), regionId: id } }),
      tx.region.count({ where: { ...live(actor.companyId), parentId: id } }),
    ]);
    if (branches || children)
      throw new AppError(409, 'CONFLICT', 'Move the branches and regions under it first');
    await tx.region.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.branchManager.deleteMany({ where: { companyId: actor.companyId, regionId: id } });
    await recordChange(tx, ctxOf(actor), {
      event: 'region.deleted',
      entityType: 'region',
      entityId: id,
      before,
    });
    return { ok: true };
  });
}

export async function saveLocation(db: Db, actor: Actor, input: LocationInput, id?: string) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    const before = id ? await tx.location.findFirst({ where: { id, ...live(actor.companyId) } }) : null;
    if (id && !before) throw notFound('Location');
    await mustExist(tx, actor.companyId, 'branch', input.branchId);
    const clash = await tx.location.findFirst({
      where: {
        ...live(actor.companyId),
        branchId: input.branchId,
        name: { equals: input.name, mode: 'insensitive' },
        ...(id ? { NOT: { id } } : {}),
      },
    });
    if (clash)
      throw new AppError(409, 'CONFLICT', `This branch already has a location called "${clash.name}"`);
    const data = { name: input.name, branchId: input.branchId, ...(input.kind ? { kind: input.kind } : {}) };
    const row = before
      ? await tx.location.update({ where: { id: before.id }, data })
      : await tx.location.create({ data: { ...data, companyId: actor.companyId } });
    await recordChange(tx, ctxOf(actor), {
      event: before ? 'location.updated' : 'location.created',
      entityType: 'location',
      entityId: row.id,
      before: before ?? undefined,
      after: row,
    });
    return row;
  });
}

export async function deleteLocation(db: Db, actor: Actor, id: string) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    const before = await tx.location.findFirst({ where: { id, ...live(actor.companyId) } });
    if (!before) throw notFound('Location');
    await tx.location.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordChange(tx, ctxOf(actor), {
      event: 'location.deleted',
      entityType: 'location',
      entityId: id,
      before,
    });
    return { ok: true };
  });
}

/** People named anywhere in the structure must be active people of this company. */
async function mustBePeople(tx: Tx, companyId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const n = await tx.user.count({
    where: { companyId, deletedAt: null, status: 'ACTIVE', id: { in: unique } },
  });
  if (n !== unique.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Someone chosen here is not an active person: pick again');
}

/** Replace who holds one role at a branch (managers, HR) or a region (area managers). */
export async function setManagers(db: Db, actor: Actor, input: ManagersInput) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    await mustExist(tx, actor.companyId, 'branch', input.branchId);
    await mustExist(tx, actor.companyId, 'region', input.regionId);
    await mustBePeople(tx, actor.companyId, input.userIds);
    const at = {
      companyId: actor.companyId,
      branchId: input.branchId ?? null,
      regionId: input.regionId ?? null,
      role: input.role,
    };
    const before = (await tx.branchManager.findMany({ where: at, select: { userId: true } })).map(
      (m) => m.userId,
    );
    await tx.branchManager.deleteMany({ where: at });
    const userIds = [...new Set(input.userIds)];
    if (userIds.length)
      await tx.branchManager.createMany({ data: userIds.map((userId) => ({ ...at, userId })) });
    await recordChange(tx, ctxOf(actor), {
      event: 'branch.managers_changed',
      entityType: input.branchId ? 'branch' : 'region',
      entityId: (input.branchId ?? input.regionId)!,
      before: { role: input.role, userIds: before },
      after: { role: input.role, userIds },
    });
    return { userIds };
  });
}

/** Where a person works: the home branch, and any others they also work at. */
export async function setPersonBranches(
  db: Db,
  actor: Actor,
  userId: string,
  input: { homeBranchId?: string | null; alsoBranchIds: string[]; from?: string },
) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    const person = await tx.user.findFirst({ where: { id: userId, ...live(actor.companyId) } });
    if (!person) throw notFound('Person');
    const also = [...new Set(input.alsoBranchIds)].filter((b) => b !== input.homeBranchId);
    for (const b of [input.homeBranchId, ...also]) await mustExist(tx, actor.companyId, 'branch', b);
    const before = (await tx.userBranch.findMany({ where: { companyId: actor.companyId, userId } })).map(
      (x) => x.branchId,
    );
    if (input.homeBranchId !== undefined && (input.homeBranchId !== person.branchId || input.from)) {
      // A move takes effect on its day (today when none is named); the home branch switches over on that day.
      const company = await tx.company.findUniqueOrThrow({
        where: { id: actor.companyId },
        select: { timezone: true },
      });
      const today = localDate(new Date(), company.timezone);
      const now = await recordMove(
        tx,
        {
          companyId: actor.companyId,
          userId,
          branchId: input.homeBranchId,
          from: input.from,
          today,
          actorId: actor.userId,
        },
        person.branchId,
      );
      if (now !== person.branchId) await tx.user.update({ where: { id: userId }, data: { branchId: now } });
    }
    await tx.userBranch.deleteMany({ where: { companyId: actor.companyId, userId } });
    if (also.length)
      await tx.userBranch.createMany({
        data: also.map((branchId) => ({ companyId: actor.companyId, userId, branchId })),
      });
    await recordChange(tx, ctxOf(actor), {
      event: 'user.branches_changed',
      entityType: 'user',
      entityId: userId,
      before: { homeBranchId: person.branchId, alsoBranchIds: before },
      after: {
        homeBranchId: input.homeBranchId === undefined ? person.branchId : input.homeBranchId,
        alsoBranchIds: also,
      },
    });
    return { ok: true };
  });
}

/** The head of a department at one branch (null takes the branch's own head away: the group-wide one applies). */
export async function setDepartmentHead(
  db: Db,
  actor: Actor,
  input: { departmentId: string; branchId: string; userId: string | null },
) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    await mustExist(tx, actor.companyId, 'branch', input.branchId);
    if (!(await tx.department.count({ where: { id: input.departmentId, ...live(actor.companyId) } })))
      throw notFound('Department');
    if (input.userId) await mustBePeople(tx, actor.companyId, [input.userId]);
    const at = { departmentId: input.departmentId, branchId: input.branchId };
    const before = await tx.departmentHead.findFirst({ where: { ...at, companyId: actor.companyId } });
    await tx.departmentHead.deleteMany({ where: { ...at, companyId: actor.companyId } });
    if (input.userId)
      await tx.departmentHead.create({ data: { ...at, companyId: actor.companyId, userId: input.userId } });
    await recordChange(tx, ctxOf(actor), {
      event: 'department.branch_head_changed',
      entityType: 'department',
      entityId: input.departmentId,
      before: { branchId: input.branchId, userId: before?.userId ?? null },
      after: { branchId: input.branchId, userId: input.userId },
    });
    return { ok: true };
  });
}

/**
 * What the person may switch between in the top bar: their branches (all of them for the whole group), and the
 * regions and entities those branches sit in — so an area manager can look at one city, an owner at one company.
 */
export async function myBranches(db: Db, actor: Actor, branchIds: string[] | null) {
  const where = live(actor.companyId);
  const branches = await db.branch.findMany({
    where: { ...where, ...(branchIds ? { id: { in: branchIds } } : {}) },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, code: true, type: true, entityId: true, regionId: true },
  });
  const [regions, entities] = await Promise.all([
    db.region.findMany({ where, select: { id: true, name: true, parentId: true }, orderBy: { name: 'asc' } }),
    db.legalEntity.findMany({ where, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  // A region counts when one of the person's branches is in it or anywhere below it.
  const used = new Set<string>();
  for (const b of branches)
    for (let r = b.regionId; r && !used.has(r); r = regions.find((x) => x.id === r)?.parentId ?? null)
      used.add(r);
  const entityIds = new Set(branches.map((b) => b.entityId));
  return {
    branches,
    regions: regions.filter((r) => used.has(r.id)).map(({ id, name }) => ({ id, name })),
    entities: entities.filter((e) => entityIds.has(e.id)),
  };
}
