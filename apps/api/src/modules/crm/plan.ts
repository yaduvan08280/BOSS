import type { Db } from '@mono/db';
import {
  buildPlan,
  DEFAULT_PLAN,
  derivedMonths,
  planInputSchema,
  planMachine,
  seatTargets,
  setPart,
  splitExact,
  transition,
  type PlanInput,
  type PlanStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { can, type Actor } from '../work/actor';
import { crmConfigOf, ctxOf, fyCalendar, isOwner, need } from './access';

async function loadPlan(db: Db, companyId: string, fy: number) {
  const row = await db.crmPlan.findUnique({ where: { companyId_fy: { companyId, fy } } });
  const parsed = planInputSchema.safeParse(row?.data ?? {});
  return { row, input: parsed.success ? parsed.data : DEFAULT_PLAN };
}

/** The year plan for an FY with every level worked out, the seats' targets, and who may do what with it. */
export async function getPlan(db: Db, actor: Actor, fyIn?: number) {
  need(actor, 'crm.view', "You can't see the sales plan");
  const f = await fyCalendar(db, actor.companyId, fyIn);
  const { row, input } = await loadPlan(db, actor.companyId, f.fy);
  const config = await crmConfigOf(db, actor.companyId);
  const view = buildPlan(input, f.cal);
  const seats = seatTargets(
    view.months.map((m) => m.turnover),
    config,
    input.roundUnit,
  );
  const names = new Map(
    (
      await db.user.findMany({
        where: {
          id: {
            in: [row?.approvedById, row?.submittedById, ...seats.rows.map((r) => r.userId)].filter(
              (x): x is string => Boolean(x),
            ),
          },
        },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return {
    fy: f.fy,
    fyStart: f.fyStart,
    today: f.today,
    status: (row?.status ?? 'DRAFT') as PlanStatus,
    saved: Boolean(row),
    submittedAt: row?.submittedAt ?? null,
    approvedAt: row?.approvedAt ?? null,
    approvedBy: row?.approvedById ? (names.get(row.approvedById) ?? null) : null,
    input,
    view,
    seats: {
      ...seats,
      rows: seats.rows.map((r) => ({ ...r, name: r.userId ? (names.get(r.userId) ?? null) : null })),
    },
    holidays: [...f.cal.holidays]
      .filter((d) => d >= f.fyStart && d < `${f.fy + 1}${f.fyStart.slice(4)}`)
      .sort(),
    workingWeekdays: [...f.cal.workingWeekdays].sort(),
    canEdit: can(actor, 'crm.admin') && row?.status !== 'APPROVED' && row?.status !== 'PENDING',
    canApprove: row?.status === 'PENDING' && (await isOwner(db, actor)),
    config,
  };
}

async function save(db: Db, actor: Actor, fy: number, input: PlanInput, action: string, after: unknown) {
  await db.$transaction(async (tx) => {
    const row = await tx.crmPlan.findUnique({ where: { companyId_fy: { companyId: actor.companyId, fy } } });
    if (row && row.status !== 'DRAFT')
      throw new AppError(
        409,
        'CONFLICT',
        row.status === 'APPROVED'
          ? 'The plan is approved. Unlock it to change it.'
          : 'The plan is waiting for approval',
      );
    await tx.crmPlan.upsert({
      where: { companyId_fy: { companyId: actor.companyId, fy } },
      create: { companyId: actor.companyId, fy, data: input as object, updatedById: actor.userId },
      update: { data: input as object, updatedById: actor.userId },
    });
    await writeAudit(tx, ctxOf(actor), {
      action,
      entityType: 'crm_plan',
      entityId: `${actor.companyId}:${fy}`,
      before: row?.data ?? null,
      after,
    });
  });
}

export const planPatchSchema = z.object({
  fy: z.number().int().min(2020).max(2100).optional(),
  input: z.record(z.string(), z.unknown()),
  resetMonths: z.boolean().default(false),
});

/**
 * Change the plan's inputs (year target, quarters, seasons, rounding, day by day…). Changing what the months
 * come from while months were set by hand needs `resetMonths` (the screen asks first).
 */
export async function savePlanInput(db: Db, actor: Actor, body: z.input<typeof planPatchSchema>) {
  need(actor, 'crm.admin', 'Only sales admins change the plan');
  const b = planPatchSchema.parse(body);
  const f = await fyCalendar(db, actor.companyId, b.fy);
  const { input } = await loadPlan(db, actor.companyId, f.fy);
  const next = planInputSchema.parse({ ...input, ...b.input });
  const shaping = [
    'lastTurnover',
    'lastGp',
    'mode',
    'growthPct',
    'exactTurnover',
    'gpMarginPct',
    'quarterGrowthPct',
    'quarterTunePct',
    'monthGrowthPct',
    'seasons',
    'roundUnit',
  ];
  const reshapes = shaping.some(
    (k) =>
      k in b.input &&
      JSON.stringify((input as Record<string, unknown>)[k]) !==
        JSON.stringify((next as Record<string, unknown>)[k]),
  );
  if (input.months && reshapes) {
    if (!b.resetMonths)
      throw new AppError(
        409,
        'MONTHS_EDITED',
        'Months were changed by hand. Changing this works the months out again.',
      );
    next.months = null;
    next.monthsGp = null;
  }
  await save(db, actor, f.fy, next, 'crm.plan_saved', b.input);
  return getPlan(db, actor, f.fy);
}

export const monthEditSchema = z.object({
  fy: z.number().int().min(2020).max(2100).optional(),
  index: z.number().int().min(0).max(11),
  turnover: z.number().int().min(0).max(1e15),
  gp: z.number().int().min(0).max(1e15).optional(),
  /** "Keep the year total — adjust other months" (else "Change the year total"). */
  keepTotal: z.boolean(),
});

/** "Change October 2026": the month's turnover (and GP); the rest of the plan follows the choice made. */
export async function editMonth(db: Db, actor: Actor, body: z.input<typeof monthEditSchema>) {
  need(actor, 'crm.admin', 'Only sales admins change the plan');
  const b = monthEditSchema.parse(body);
  const f = await fyCalendar(db, actor.companyId, b.fy);
  const { input } = await loadPlan(db, actor.companyId, f.fy);
  const view = buildPlan(input, f.cal);
  const turn = input.months ?? derivedMonths(input, f.cal);
  const gp = input.monthsGp ?? view.months.map((m) => m.gp);
  let months: number[];
  try {
    months = setPart(turn, b.index, b.turnover, b.keepTotal, input.roundUnit);
  } catch {
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'A month can’t be more than the whole year when the year total is kept',
    );
  }
  // GP: the amount given, else the month's margin as it was.
  const margin = turn[b.index] ? gp[b.index]! / turn[b.index]! : view.year.marginPct / 100;
  const g = b.gp ?? Math.round(b.turnover * margin);
  let monthsGp: number[];
  try {
    monthsGp = setPart(gp, b.index, g, b.keepTotal, input.roundUnit);
  } catch {
    monthsGp = splitExact(
      gp.reduce((a, x) => a + x, 0),
      months,
    );
  }
  await save(db, actor, f.fy, { ...input, months, monthsGp }, 'crm.plan_month_changed', b);
  return getPlan(db, actor, f.fy);
}

/** Send for approval / approve / send back / withdraw / unlock (§11: the owner approves). */
export async function planAction(
  db: Db,
  actor: Actor,
  action: 'submit' | 'approve' | 'reject' | 'withdraw' | 'unlock',
  fyIn?: number,
  note?: string,
) {
  const f = await fyCalendar(db, actor.companyId, fyIn);
  const { row } = await loadPlan(db, actor.companyId, f.fy);
  if (!row) throw new AppError(409, 'CONFLICT', 'Save the plan first');
  const owner = await isOwner(db, actor);
  const roles = [
    ...(can(actor, 'crm.admin') ? (['editor'] as const) : []),
    ...(owner ? (['owner'] as const) : []),
  ];
  if (!roles.length) throw new AppError(403, 'FORBIDDEN', "You can't change the plan's status");
  const to = transition(planMachine, { from: row.status as PlanStatus, action, roles, ctx: {} }).to;
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.crmPlan.update({
      where: { id: row.id },
      data: {
        status: to,
        ...(action === 'submit' ? { submittedById: actor.userId, submittedAt: now } : {}),
        ...(action === 'approve' ? { approvedById: actor.userId, approvedAt: now } : {}),
        ...(action === 'unlock' || action === 'reject' ? { approvedById: null, approvedAt: null } : {}),
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: `crm.plan_${action}`,
      entityType: 'crm_plan',
      entityId: row.id,
      before: { status: row.status },
      after: { status: to, note },
    });
    await emitEvent(tx, ctxOf(actor), {
      name: `crm.plan_${action}`,
      entityType: 'crm_plan',
      entityId: row.id,
      payload: { fy: f.fy, status: to, note: note ?? null },
    });
  });
  return getPlan(db, actor, f.fy);
}
