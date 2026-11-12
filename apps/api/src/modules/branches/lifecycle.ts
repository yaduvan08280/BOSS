import type { Db, Prisma, Tx } from '@mono/db';
import type { ChecklistBranchPlan } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { can, type Actor } from '../work/actor';

/**
 * Opening and closing outlets (phase 12, plan §3.11).
 *
 * Open by copying: the new branch takes the other's kind, entity, region, clock, stock locations, approval
 * routes and its place on every per-branch checklist (same times, people still to be chosen). People are never
 * copied — the result says what is left to do.
 *
 * Close safely: nothing is lost and nothing is left hanging. The branch's people and its open work must go to
 * another branch first (in the same step, when one is named); then it is archived and leaves every picker, while
 * finished work keeps pointing at it.
 */
const ctxOf = (a: Actor) => ({ companyId: a.companyId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });
const needEdit = (a: Actor) => {
  if (!can(a, 'org.edit')) throw new AppError(403, 'FORBIDDEN', "You can't change the company's structure");
};
async function liveBranch(tx: Db | Tx, companyId: string, id: string) {
  const b = await tx.branch.findFirst({ where: { id, companyId, deletedAt: null } });
  if (!b) throw notFound('Branch');
  return b;
}
const plansOf = (json: Prisma.JsonValue | null) => (json as ChecklistBranchPlan[] | null) ?? [];

export async function copyBranch(
  db: Db,
  actor: Actor,
  fromId: string,
  input: { name: string; code?: string | null; city?: string | null; regionId?: string | null },
) {
  needEdit(actor);
  const companyId = actor.companyId;
  return db.$transaction(async (tx) => {
    const from = await liveBranch(tx, companyId, fromId);
    const made = await tx.branch.create({
      data: {
        companyId,
        name: input.name,
        code: input.code ?? null,
        city: input.city ?? from.city,
        state: from.state,
        entityId: from.entityId,
        regionId: input.regionId === undefined ? from.regionId : input.regionId,
        type: from.type,
        timezone: from.timezone,
      },
    });
    const locations = await tx.location.findMany({
      where: { companyId, branchId: from.id, deletedAt: null },
    });
    if (locations.length)
      await tx.location.createMany({
        data: locations.map((l) => ({ companyId, branchId: made.id, name: l.name, kind: l.kind })),
      });
    const routes = await tx.approvalRoute.findMany({ where: { companyId, branchId: from.id } });
    for (const r of routes)
      await tx.approvalRoute.create({
        data: {
          companyId,
          kind: r.kind,
          branchId: made.id,
          steps: r.steps as Prisma.InputJsonValue,
          updatedById: actor.userId,
        },
      });
    // Per-branch checklists: the same place and time, with the people still to be picked.
    const masters = await tx.checklistMaster.findMany({ where: { companyId, deletedAt: null } });
    let checklists = 0;
    for (const m of masters) {
      const mine = plansOf(m.perBranch).find((p) => p.branchId === from.id);
      if (!mine) continue;
      checklists++;
      const next = [...plansOf(m.perBranch), { branchId: made.id, doerIds: [], dueTime: mine.dueTime }];
      await tx.checklistMaster.update({
        where: { id: m.id },
        data: { perBranch: next as unknown as Prisma.InputJsonValue },
      });
    }
    await recordChange(tx, ctxOf(actor), {
      event: 'branch.created',
      entityType: 'branch',
      entityId: made.id,
      after: { name: made.name, copiedFrom: from.id },
    });
    return {
      id: made.id,
      copied: { locations: locations.length, routes: routes.length, checklists },
      // What only a person can decide.
      todo: { manager: true, people: true, checklistDoers: checklists },
    };
  });
}

/** What still sits at a branch: the things that must move before it can close. */
async function holdings(tx: Db | Tx, companyId: string, branchId: string) {
  const at = { companyId, branchId };
  const [people, tasks, runs, slips, tickets, records, orders] = await Promise.all([
    tx.user.count({ where: { ...at, deletedAt: null, status: 'ACTIVE' } }),
    tx.task.count({ where: { ...at, deletedAt: null, status: { notIn: ['DONE', 'CANCELLED'] } } }),
    tx.checklistRun.count({ where: { ...at, status: { in: ['OPEN', 'PENDING_VERIFY'] } } }),
    tx.slip.count({
      where: { ...at, deletedAt: null, status: { notIn: ['CLOSED', 'WITHDRAWN'] } },
    }),
    tx.ticket.count({ where: { ...at, deletedAt: null, status: { notIn: ['CLOSED', 'CANCELLED'] } } }),
    tx.fmsRecord.count({ where: { ...at, deletedAt: null, status: { in: ['RUNNING', 'ON_HOLD'] } } }),
    tx.purchaseOrder.count({ where: { ...at, status: { in: ['DRAFT', 'SENT', 'PARTLY_RECEIVED'] } } }),
  ]);
  return { people, tasks, checklistRuns: runs, slips, tickets, records, purchaseOrders: orders };
}

export async function closePreview(db: Db, actor: Actor, id: string) {
  needEdit(actor);
  await liveBranch(db, actor.companyId, id);
  const holds = await holdings(db, actor.companyId, id);
  return { holds, clear: Object.values(holds).every((n) => n === 0) };
}

export async function closeBranch(db: Db, actor: Actor, id: string, moveToId?: string | null) {
  needEdit(actor);
  const companyId = actor.companyId;
  return db.$transaction(async (tx) => {
    const branch = await liveBranch(tx, companyId, id);
    if (branch.isDefault) throw new AppError(409, 'CONFLICT', 'Make another branch the default one first');
    const holds = await holdings(tx, companyId, id);
    const busy = Object.values(holds).some((n) => n > 0);
    if (busy && !moveToId)
      throw new AppError(409, 'CONFLICT', 'This branch still has people or open work: choose where they go', {
        holds,
      });
    if (moveToId) {
      if (moveToId === id) throw new AppError(400, 'VALIDATION_FAILED', 'Choose a different branch');
      await liveBranch(tx, companyId, moveToId);
      const at = { companyId, branchId: id };
      const to = { branchId: moveToId };
      await tx.user.updateMany({ where: { ...at, deletedAt: null }, data: to });
      await tx.task.updateMany({ where: { ...at, status: { notIn: ['DONE', 'CANCELLED'] } }, data: to });
      await tx.checklistRun.updateMany({
        where: { ...at, status: { in: ['OPEN', 'PENDING_VERIFY'] } },
        data: to,
      });
      await tx.slip.updateMany({
        where: { ...at, status: { notIn: ['CLOSED', 'WITHDRAWN'] } },
        data: to,
      });
      await tx.ticket.updateMany({ where: { ...at, status: { notIn: ['CLOSED', 'CANCELLED'] } }, data: to });
      await tx.fmsRecord.updateMany({ where: { ...at, status: { in: ['RUNNING', 'ON_HOLD'] } }, data: to });
      await tx.purchaseOrder.updateMany({
        where: { ...at, status: { in: ['DRAFT', 'SENT', 'PARTLY_RECEIVED'] } },
        data: to,
      });
    }
    // Nobody runs a closed branch, nothing new is made for it.
    await tx.branchManager.deleteMany({ where: { companyId, branchId: id } });
    await tx.userBranch.deleteMany({ where: { companyId, branchId: id } });
    await tx.departmentHead.deleteMany({ where: { companyId, branchId: id } });
    await tx.approvalRoute.deleteMany({ where: { companyId, branchId: id } });
    await tx.moduleBranchSetting.deleteMany({ where: { companyId, branchId: id } });
    for (const m of await tx.checklistMaster.findMany({ where: { companyId, deletedAt: null } })) {
      const plans = plansOf(m.perBranch);
      if (!plans.some((p) => p.branchId === id)) continue;
      const rest = plans.filter((p) => p.branchId !== id);
      await tx.checklistMaster.update({
        where: { id: m.id },
        // The last branch of a per-branch template gone: the template stops making runs.
        data: rest.length
          ? { perBranch: rest as unknown as Prisma.InputJsonValue }
          : { perBranch: [] as Prisma.InputJsonValue, active: false },
      });
    }
    const now = new Date();
    await tx.branch.update({ where: { id }, data: { closedAt: now, deletedAt: now } });
    await recordChange(tx, ctxOf(actor), {
      event: 'branch.deleted',
      entityType: 'branch',
      entityId: id,
      before: { name: branch.name },
      after: { closed: true, movedTo: moveToId ?? null, moved: holds },
    });
    return { ok: true, moved: moveToId ? holds : null };
  });
}
