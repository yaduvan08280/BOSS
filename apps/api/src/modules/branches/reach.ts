import { currentReach, type Db, type Reach, type Tx } from '@mono/db';
import { AppError } from '../../lib/errors';

export const REACHES = ['own', 'branches', 'entity', 'group'] as const;
export type RoleReach = (typeof REACHES)[number];

/** A region and every region under it. */
function withChildren(all: { id: string; parentId: string | null }[], roots: string[]): string[] {
  const out = new Set(roots);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of all)
      if (r.parentId && out.has(r.parentId) && !out.has(r.id)) {
        out.add(r.id);
        grew = true;
      }
  }
  return [...out];
}

/**
 * The branches a person is part of: their home branch, the ones they also work at, the ones they manage (or are
 * the HR person of), and every branch of the regions they are area manager of.
 */
export async function branchesOf(db: Db | Tx, companyId: string, userId: string): Promise<string[]> {
  const [user, works, manages] = await Promise.all([
    db.user.findFirst({ where: { id: userId, companyId }, select: { branchId: true } }),
    db.userBranch.findMany({ where: { companyId, userId }, select: { branchId: true } }),
    db.branchManager.findMany({ where: { companyId, userId }, select: { branchId: true, regionId: true } }),
  ]);
  const ids = new Set<string>();
  if (user?.branchId) ids.add(user.branchId);
  for (const w of works) ids.add(w.branchId);
  for (const m of manages) if (m.branchId) ids.add(m.branchId);
  const regions = manages.flatMap((m) => (m.regionId ? [m.regionId] : []));
  if (regions.length) {
    const all = await db.region.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const under = await db.branch.findMany({
      where: { companyId, deletedAt: null, regionId: { in: withChildren(all, regions) } },
      select: { id: true },
    });
    for (const b of under) ids.add(b.id);
  }
  return [...ids];
}

/**
 * How far a person sees (plan §3.3). Owners and roles with the reach "group" see everything. "entity" widens a
 * person's branches to every branch of their legal entities. "branches" and "own" are the person's branches at
 * the database fence — "own" people are narrowed further by each module's own rules (my tasks, my leave), as
 * before.
 */
export async function reachFor(
  db: Db | Tx,
  who: { companyId: string; userId: string; permissions: string[]; reach: string },
): Promise<Reach> {
  const everything = who.permissions.includes('*') || who.reach === 'group';
  let ids: string[] | null = null;
  if (!everything) {
    ids = await branchesOf(db, who.companyId, who.userId);
    if (who.reach === 'entity' && ids.length) {
      const mine = await db.branch.findMany({
        where: { companyId: who.companyId, id: { in: ids }, entityId: { not: null } },
        select: { entityId: true },
      });
      const entities = [...new Set(mine.map((b) => b.entityId!))];
      if (entities.length) {
        const all = await db.branch.findMany({
          where: { companyId: who.companyId, deletedAt: null, entityId: { in: entities } },
          select: { id: true },
        });
        ids = [...new Set([...ids, ...all.map((b) => b.id)])];
      }
    }
  }
  return { userId: who.userId, branchIds: ids };
}

/**
 * What the top bar's switcher shows narrows a reach; it can never widen it. The value is a branch id, or
 * `r:<region>` (that region and the regions inside it) or `e:<entity>` — each cut down to the branches the
 * person may see anyway. Something they may not see at all leaves the reach as it was.
 */
export async function narrowTo(
  db: Db | Tx,
  companyId: string,
  reach: Reach,
  only: string | null,
): Promise<Reach> {
  if (!only) return reach;
  const live = { companyId, deletedAt: null };
  let wanted: string[];
  if (only.startsWith('r:')) {
    const regions = await db.region.findMany({ where: live, select: { id: true, parentId: true } });
    const inside = withChildren(regions, [only.slice(2)]);
    wanted = (
      await db.branch.findMany({ where: { ...live, regionId: { in: inside } }, select: { id: true } })
    ).map((b) => b.id);
  } else if (only.startsWith('e:')) {
    wanted = (
      await db.branch.findMany({ where: { ...live, entityId: only.slice(2) }, select: { id: true } })
    ).map((b) => b.id);
  } else {
    wanted = (await db.branch.count({ where: { id: only, ...live } })) > 0 ? [only] : [];
  }
  const allowed = reach.branchIds ? wanted.filter((id) => reach.branchIds!.includes(id)) : wanted;
  return allowed.length ? { userId: reach.userId, branchIds: allowed, strict: true } : reach;
}

/** A person's home branch — the branch new work for them belongs to (null when the company has none set). */
export async function homeBranchOf(db: Db | Tx, companyId: string, userId: string | null | undefined) {
  if (!userId) return null;
  const u = await db.user.findFirst({ where: { id: userId, companyId }, select: { branchId: true } });
  return u?.branchId ?? null;
}

/** A person's reach outside a web request (the worker: webhooks, scheduled reports). Null = they are gone. */
export async function reachOfUser(db: Db | Tx, companyId: string, userId: string): Promise<Reach | null> {
  const u = await db.user.findFirst({
    where: { id: userId, companyId, deletedAt: null },
    select: { role: { select: { permissions: true, reach: true } } },
  });
  if (!u) return null;
  return reachFor(db, { companyId, userId, permissions: u.role.permissions, reach: u.role.reach });
}

/**
 * Where a new master row or record may be put (phase 12): a branch the person may see, or — for people who see the
 * whole group — nowhere in particular (null = group-wide, everyone reads it).
 */
export async function placeAt(
  db: Db | Tx,
  companyId: string,
  branchId: string | null,
): Promise<string | null> {
  const mine = currentReach()?.branchIds ?? null;
  if (branchId === null) {
    if (mine) throw new AppError(403, 'FORBIDDEN', "Only the group's people make something for every branch");
    return null;
  }
  if (mine && !mine.includes(branchId))
    throw new AppError(403, 'FORBIDDEN', "That branch isn't one of yours");
  if (!(await db.branch.count({ where: { id: branchId, companyId, deletedAt: null } })))
    throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  return branchId;
}
