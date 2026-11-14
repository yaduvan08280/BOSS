import type { Db } from '@mono/db';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { handOverWork, managerFor, openWorkOf, type WorkChoice } from './handover';
import { setPersonBranches } from './structure';

/**
 * Where people work, for the people lists: each person's home branch by name and the other branches they also
 * work at. Kept apart from the person row so every list reads it the same way.
 */
export async function placesOf(db: Db, companyId: string) {
  const [branches, also] = await Promise.all([
    db.branch.findMany({ where: { companyId }, select: { id: true, name: true } }),
    db.userBranch.findMany({ where: { companyId }, select: { userId: true, branchId: true } }),
  ]);
  const name = new Map(branches.map((b) => [b.id, b.name]));
  const others = new Map<string, string[]>();
  for (const a of also) others.set(a.userId, [...(others.get(a.userId) ?? []), a.branchId]);
  return <T extends { id: string; branchId: string | null }>(p: T) => ({
    ...p,
    branchName: p.branchId ? (name.get(p.branchId) ?? null) : null,
    alsoBranchIds: (others.get(p.id) ?? []).filter((b) => b !== p.branchId),
  });
}

/**
 * Move several people to one branch from a day (a transfer of a team, or giving a branch to people who have
 * none). The other branches each of them also works at are kept. All or nothing on who and where.
 */
export async function movePeople(
  db: Db,
  actor: Actor,
  input: { userIds: string[]; homeBranchId: string | null; from?: string; work?: WorkChoice },
) {
  const ids = [...new Set(input.userIds)];
  const people = await db.user.findMany({
    where: { id: { in: ids }, companyId: actor.companyId, deletedAt: null },
    select: { id: true, branchId: true },
  });
  if (people.length !== ids.length) throw notFound('Person');
  if (
    input.homeBranchId &&
    !(await db.branch.count({
      where: { id: input.homeBranchId, companyId: actor.companyId, deletedAt: null },
    }))
  )
    throw notFound('Branch');
  if (input.from && !/^\d{4}-\d{2}-\d{2}$/.test(input.from))
    throw new AppError(400, 'BAD_REQUEST', 'Give the day as YYYY-MM-DD');
  const also = await db.userBranch.findMany({
    where: { companyId: actor.companyId, userId: { in: ids } },
    select: { userId: true, branchId: true },
  });
  let moved = 0;
  for (const p of people) {
    if (p.branchId === input.homeBranchId && !input.from) continue;
    await placePerson(db, actor, p.id, {
      homeBranchId: input.homeBranchId,
      alsoBranchIds: also.filter((a) => a.userId === p.id).map((a) => a.branchId),
      ...(input.from ? { from: input.from } : {}),
      ...(input.work ? { work: input.work } : {}),
    });
    moved += 1;
  }
  return { moved, unchanged: people.length - moved };
}

/**
 * Save where a person works; when the home branch changes, their open work stays with them, goes to a named
 * person, or goes back to the manager of the branch they leave (else whom they report to).
 */
export async function placePerson(
  db: Db,
  actor: Actor,
  userId: string,
  input: { homeBranchId?: string | null; alsoBranchIds: string[]; from?: string; work?: WorkChoice },
) {
  const { work, ...place } = input;
  const before = await db.user.findFirst({
    where: { id: userId, companyId: actor.companyId, deletedAt: null },
    select: { branchId: true, name: true },
  });
  if (!before) throw notFound('Person');
  const moving = place.homeBranchId !== undefined && place.homeBranchId !== before.branchId;
  // Decide who takes the work before anything is saved, so a transfer never half-happens.
  let takerId: string | null = null;
  if (moving && work && work.mode !== 'keep') {
    takerId =
      work.mode === 'handover'
        ? (work.toUserId ?? null)
        : ((await db.$transaction((tx) => managerFor(tx, actor.companyId, userId, before.branchId)))?.id ??
          null);
    if (!takerId)
      throw new AppError(
        400,
        'BAD_REQUEST',
        work.mode === 'handover'
          ? 'Choose who takes the work'
          : 'The branch has no manager to take the work back. Choose a person instead.',
      );
  }
  const saved = await setPersonBranches(db, actor, userId, place);
  if (!takerId) return { ...saved, handedOver: null };
  const handedOver = await db.$transaction((tx) =>
    handOverWork(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      userId,
      takerId,
      `${before.name} moved to another branch`,
    ),
  );
  return { ...saved, handedOver };
}

/** A person's moves between branches, newest first, and the days they were lent elsewhere. */
export async function personPlaces(db: Db, actor: Actor, userId: string) {
  const person = await db.user.findFirst({
    where: { id: userId, companyId: actor.companyId, deletedAt: null },
    select: { id: true, branchId: true },
  });
  if (!person) throw notFound('Person');
  const [openWork, manager] = await db.$transaction(
    async (tx) =>
      [
        await openWorkOf(tx, actor.companyId, userId),
        await managerFor(tx, actor.companyId, userId, person.branchId),
      ] as const,
  );
  const [stays, loans, also] = await Promise.all([
    db.branchStay.findMany({
      where: { companyId: actor.companyId, userId },
      orderBy: { from: 'desc' },
      select: { branchId: true, from: true, fromBranchId: true, createdAt: true },
    }),
    db.branchLoan.findMany({
      where: { companyId: actor.companyId, userId },
      orderBy: { from: 'desc' },
      select: { id: true, branchId: true, from: true, to: true },
    }),
    db.userBranch.findMany({ where: { companyId: actor.companyId, userId }, select: { branchId: true } }),
  ]);
  return {
    homeBranchId: person.branchId,
    openWork,
    manager,
    alsoBranchIds: also.map((a) => a.branchId).filter((b) => b !== person.branchId),
    // "0000-01-01" means "from the beginning" (the first branch of someone who had none).
    moves: stays.map((s) => ({ ...s, from: s.from.startsWith('0000') ? null : s.from })),
    loans,
  };
}
