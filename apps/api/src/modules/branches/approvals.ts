import type { Db, Prisma, Tx } from '@mono/db';
import {
  approvalRouteSchema,
  type ApprovalKind,
  type ApprovalRouteInput,
  type ApprovalStep,
} from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { can, type Actor } from '../work/actor';

/**
 * Approval routing (phase 12, plan §3.2, decision 14): the owner decides who approves what. A route is an ordered
 * ladder of steps for one kind of request, for the whole group or for one entity or branch. One decision decides.
 *
 * - The request starts at the first step — or, when steps carry "from this amount", at the last such step the
 *   amount reaches (₹50,000 with "area manager from ₹10,000" starts at the area manager; the steps before it are out).
 * - A step nobody holds (or held only by the requester) is passed over when it says so; otherwise the request waits.
 * - "Go up after N hours": once that long has passed at a step, the next step may decide too.
 * - The owner can always decide, so nothing is ever stuck.
 *
 * With no route set for a kind, each module keeps its own rule (HOD for leave, the listed approvers for stock …).
 */

type Request = {
  requesterId: string;
  /** The branch the request belongs to. Default: the requester's home branch. */
  branchId?: string | null;
  /** Default: the requester's main department. */
  departmentId?: string | null;
  /** Rupees, for kinds with amounts (stock adjustments). */
  amount?: number;
  /** When the request was made (for "go up after N hours"). Default: now — only the first step is open. */
  askedAt?: Date;
};

export type Chain = {
  /** The steps that apply to this request, in order, with the people who hold each. */
  steps: { who: ApprovalStep['who']; userIds: string[]; open: boolean }[];
  /** The people to ask first. */
  first: string[];
  /** Everyone who may decide right now (the owner is added by `mayDecide`). */
  deciders: string[];
};

const stepsOf = (json: Prisma.JsonValue): ApprovalStep[] =>
  approvalRouteSchema.shape.steps.safeParse(json).data ?? [];

/** The route for a kind at a branch: the branch's own, else its entity's, else the group's; null when none is set. */
export async function routeOf(
  db: Db | Tx,
  companyId: string,
  kind: ApprovalKind,
  branchId: string | null | undefined,
): Promise<ApprovalStep[] | null> {
  const rows = await db.approvalRoute.findMany({ where: { companyId, kind } });
  if (!rows.length) return null;
  const branch = branchId
    ? await db.branch.findFirst({ where: { id: branchId, companyId }, select: { entityId: true } })
    : null;
  const row =
    (branchId && rows.find((r) => r.branchId === branchId)) ||
    (branch?.entityId && rows.find((r) => r.entityId === branch.entityId && !r.branchId)) ||
    rows.find((r) => !r.branchId && !r.entityId);
  if (!row) return null;
  const steps = stepsOf(row.steps);
  return steps.length ? steps : null;
}

/** The people who hold a step for this request (active people only; never the requester). */
async function holders(
  db: Db | Tx,
  companyId: string,
  step: ApprovalStep,
  at: { requesterId: string; branchId: string | null; departmentId: string | null; keepRequester?: boolean },
): Promise<string[]> {
  let ids: (string | null | undefined)[] = [];
  const managers = (role: string, where: { branchId?: string; regionId?: { in: string[] } }) =>
    db.branchManager.findMany({ where: { companyId, role, ...where }, select: { userId: true } });
  if (step.who === 'user') ids = [step.userId];
  else if (step.who === 'owner')
    ids = (
      await db.user.findMany({
        where: { companyId, deletedAt: null, role: { key: 'OWNER' } },
        select: { id: true },
      })
    ).map((u) => u.id);
  else if (step.who === 'hr') {
    const rules = await db.hrRules.findUnique({ where: { companyId }, select: { rules: true } });
    ids = [(rules?.rules as { leave?: { hrUserId?: string | null } } | null)?.leave?.hrUserId];
  } else if (step.who === 'department_head') {
    if (at.departmentId) {
      const here = at.branchId
        ? await db.departmentHead.findFirst({
            where: { companyId, departmentId: at.departmentId, branchId: at.branchId },
          })
        : null;
      const dep = here
        ? null
        : await db.department.findFirst({
            where: { id: at.departmentId, companyId },
            select: { hodUserId: true, parent: { select: { hodUserId: true } } },
          });
      ids = [here?.userId ?? (dep?.hodUserId !== at.requesterId ? dep?.hodUserId : dep?.parent?.hodUserId)];
    }
  } else if (at.branchId) {
    if (step.who === 'branch_manager')
      ids = (await managers('MANAGER', { branchId: at.branchId })).map((m) => m.userId);
    else if (step.who === 'branch_hr')
      ids = (await managers('HR', { branchId: at.branchId })).map((m) => m.userId);
    else {
      // Area managers of the branch's region and of every region above it.
      const branch = await db.branch.findFirst({
        where: { id: at.branchId, companyId },
        select: { regionId: true },
      });
      const regions = await db.region.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, parentId: true },
      });
      const up: string[] = [];
      for (let r = branch?.regionId; r && !up.includes(r); r = regions.find((x) => x.id === r)?.parentId)
        up.push(r);
      if (up.length) ids = (await managers('AREA', { regionId: { in: up } })).map((m) => m.userId);
    }
  }
  const wanted = [
    ...new Set(ids.filter((x): x is string => Boolean(x) && (at.keepRequester || x !== at.requesterId))),
  ];
  if (!wanted.length) return [];
  const active = await db.user.findMany({
    where: { id: { in: wanted }, companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  });
  const ok = new Set(active.map((u) => u.id));
  return wanted.filter((id) => ok.has(id));
}

/**
 * Who holds a place for a person (notification recipients "branch manager", "area manager", "branch HR",
 * "department head at this branch"): read from the person's home branch and department, or the branch given.
 */
export async function placeHolders(
  db: Db | Tx,
  companyId: string,
  who: Exclude<ApprovalStep['who'], 'user'>,
  subjectId: string | null,
  branchId?: string | null,
): Promise<string[]> {
  const subject = subjectId
    ? await db.user.findFirst({
        where: { id: subjectId, companyId },
        select: { branchId: true, mainDepartmentId: true },
      })
    : null;
  return holders(
    db,
    companyId,
    { who },
    {
      requesterId: subjectId ?? '',
      branchId: branchId ?? subject?.branchId ?? null,
      departmentId: subject?.mainDepartmentId ?? null,
      keepRequester: true,
    },
  );
}

/** Whether the owner has set any route for this kind (lists skip the ladder work when there is none). */
export const hasRoute = async (db: Db | Tx, companyId: string, kind: ApprovalKind) =>
  (await db.approvalRoute.count({ where: { companyId, kind } })) > 0;

/** The ladder for one request, or null when the owner has set no route for this kind (the module's own rule). */
export async function chainFor(
  db: Db | Tx,
  companyId: string,
  kind: ApprovalKind,
  req: Request,
  now = new Date(),
): Promise<Chain | null> {
  const requester = await db.user.findFirst({
    where: { id: req.requesterId, companyId },
    select: { branchId: true, mainDepartmentId: true },
  });
  const branchId = req.branchId === undefined ? (requester?.branchId ?? null) : req.branchId;
  const route = await routeOf(db, companyId, kind, branchId);
  if (!route) return null;
  const at = {
    requesterId: req.requesterId,
    branchId,
    departmentId: req.departmentId === undefined ? (requester?.mainDepartmentId ?? null) : req.departmentId,
  };
  // Amounts: start at the last step the amount reaches.
  const amount = req.amount ?? 0;
  let start = 0;
  route.forEach((s, i) => {
    if (s.fromAmount !== undefined && s.fromAmount > 0 && amount >= s.fromAmount) start = i;
  });
  const applies = route
    .slice(start)
    .filter((s, i) => i === 0 || s.fromAmount === undefined || amount >= s.fromAmount);
  const steps: Chain['steps'] = [];
  // `reached`: when the request came to this step; null once it is waiting somewhere below.
  let reached: number | null = (req.askedAt ?? now).getTime();
  for (const s of applies) {
    const userIds = await holders(db, companyId, s, at);
    const open = reached !== null && reached <= now.getTime();
    steps.push({ who: s.who, userIds, open: open && userIds.length > 0 });
    if (reached === null) continue;
    if (!userIds.length) {
      // Nobody here: pass it on at once, or wait here for good.
      if (!s.skipIfEmpty) reached = null;
    } else if (!open) reached = null;
    else reached = s.escalateAfterHours ? reached + s.escalateAfterHours * 3_600_000 : null;
  }
  return {
    steps,
    first: steps.find((s) => s.userIds.length)?.userIds ?? [],
    deciders: [...new Set(steps.filter((s) => s.open).flatMap((s) => s.userIds))],
  };
}

/**
 * May this person decide the request? null = no route is set, ask the module's own rule. Nobody decides their own
 * request; the owner always may.
 */
export async function mayDecide(
  db: Db | Tx,
  actor: Actor,
  kind: ApprovalKind,
  req: Request,
  now = new Date(),
): Promise<boolean | null> {
  const chain = await chainFor(db, actor.companyId, kind, req, now);
  if (!chain) return null;
  if (actor.userId === req.requesterId) return false;
  if (chain.deciders.includes(actor.userId)) return true;
  return Boolean(
    await db.user.count({ where: { id: actor.userId, companyId: actor.companyId, role: { key: 'OWNER' } } }),
  );
}

// ───────────── the setting ─────────────

/** Routing is the owner's to set (and whoever the owner gave the company's admin right). */
const needAdmin = (a: Actor) => {
  if (!can(a, 'core.admin')) throw new AppError(403, 'FORBIDDEN', 'Only the owner sets who approves');
};
const ctxOf = (a: Actor) => ({ companyId: a.companyId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });

export async function listRoutes(db: Db, actor: Actor) {
  const rows = await db.approvalRoute.findMany({
    where: { companyId: actor.companyId },
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    entityId: r.entityId,
    branchId: r.branchId,
    steps: stepsOf(r.steps),
    updatedAt: r.updatedAt,
  }));
}

/** One route per kind and place: saving again replaces it. */
export async function saveRoute(db: Db, actor: Actor, input: ApprovalRouteInput) {
  needAdmin(actor);
  const entityId = input.branchId ? null : (input.entityId ?? null);
  const branchId = input.branchId ?? null;
  return db.$transaction(async (tx) => {
    const live = { companyId: actor.companyId, deletedAt: null };
    if (branchId && !(await tx.branch.count({ where: { id: branchId, ...live } }))) throw notFound('Branch');
    if (entityId && !(await tx.legalEntity.count({ where: { id: entityId, ...live } })))
      throw notFound('Legal entity');
    const people = input.steps.flatMap((s) => (s.userId ? [s.userId] : []));
    const found = await tx.user.count({ where: { id: { in: people }, ...live, status: 'ACTIVE' } });
    if (found !== new Set(people).size)
      throw new AppError(400, 'VALIDATION_FAILED', 'A chosen person is not an active person');
    const where = { companyId: actor.companyId, kind: input.kind, entityId, branchId };
    const before = await tx.approvalRoute.findFirst({ where });
    const steps = input.steps as unknown as Prisma.InputJsonValue;
    const row = before
      ? await tx.approvalRoute.update({
          where: { id: before.id },
          data: { steps, updatedById: actor.userId },
        })
      : await tx.approvalRoute.create({ data: { ...where, steps, updatedById: actor.userId } });
    await recordChange(tx, ctxOf(actor), {
      event: 'approval_route.saved',
      entityType: 'approval_route',
      entityId: row.id,
      before: before ? { steps: before.steps } : null,
      after: { kind: input.kind, entityId, branchId, steps: input.steps },
    });
    return { id: row.id };
  });
}

/** Removing a route puts that place back on the route above it (entity, group), or on the module's own rule. */
export async function deleteRoute(db: Db, actor: Actor, id: string) {
  needAdmin(actor);
  return db.$transaction(async (tx) => {
    const before = await tx.approvalRoute.findFirst({ where: { id, companyId: actor.companyId } });
    if (!before) throw notFound('Approval route');
    await tx.approvalRoute.delete({ where: { id } });
    await recordChange(tx, ctxOf(actor), {
      event: 'approval_route.removed',
      entityType: 'approval_route',
      entityId: id,
      before: {
        kind: before.kind,
        entityId: before.entityId,
        branchId: before.branchId,
        steps: before.steps,
      },
      after: null,
    });
    return { ok: true };
  });
}
