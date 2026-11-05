import type { Db, Tx } from '@mono/db';
import {
  crmConfigSchema,
  DEFAULT_CRM_CONFIG,
  localDate,
  type CrmConfig,
  type PlanCalendar,
  type Seat,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { companyCalendar } from '../hr/calendar';
import { isOwner } from '../ims/access';
import { can, type Actor } from '../work/actor';

export { isOwner };
export const need = (actor: Actor, key: Parameters<typeof can>[1], message: string) => {
  if (!can(actor, key)) throw new AppError(403, 'FORBIDDEN', message);
};
export const ctxOf = (actor: Actor) => ({ ...actor, actorId: actor.userId });
export const money = (paise: bigint | number | null | undefined) => String(paise ?? 0);

export async function crmConfigOf(db: Db | Tx, companyId: string): Promise<CrmConfig> {
  const row = await db.crmSettings.findUnique({ where: { companyId } });
  const parsed = crmConfigSchema.safeParse(row?.config ?? {});
  return parsed.success ? parsed.data : DEFAULT_CRM_CONFIG;
}

/** The people in a seat (the owner seat falls back to the company's owners). */
export async function seatPeople(db: Db | Tx, companyId: string, seat: Seat, config?: CrmConfig) {
  const c = config ?? (await crmConfigOf(db, companyId));
  const ids = c.seats[seat] ?? [];
  if (ids.length || seat !== 'owner') return ids;
  return (
    await db.user.findMany({
      where: { companyId, deletedAt: null, role: { key: 'OWNER' } },
      select: { id: true },
    })
  ).map((u) => u.id);
}

/** Save part of the configuration (only the keys sent change). Seat holders must be active people. */
export async function saveConfig(db: Db, actor: Actor, patch: Partial<CrmConfig>, page?: string) {
  need(actor, 'crm.admin', 'Only sales admins change the CRM setup');
  const current = await crmConfigOf(db, actor.companyId);
  const done = page && !current.done.includes(page) ? [...current.done, page] : current.done;
  const config = crmConfigSchema.parse({ ...current, ...patch, done: patch.done ?? done });
  const ids = [...new Set(Object.values(config.seats).flat())];
  if (ids.length) {
    const found = await db.user.count({
      where: { companyId: actor.companyId, id: { in: ids }, deletedAt: null, status: 'ACTIVE' },
    });
    if (found !== ids.length)
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'Someone in a seat is not an active person in the company',
      );
  }
  const stages = config.nbd.stages.map((s) => s.key);
  if (new Set(stages).size !== stages.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Two funnel stages have the same key');
  await db.$transaction(async (tx) => {
    const before = await tx.crmSettings.findUnique({ where: { companyId: actor.companyId } });
    await tx.crmSettings.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, config: config as object, updatedById: actor.userId },
      update: { config: config as object, updatedById: actor.userId },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'crm.config_saved',
      entityType: 'crm_settings',
      entityId: actor.companyId,
      before: before?.config ?? null,
      after: patch,
    });
  });
  return config;
}

/** The company's FY (first year, first day) for a date, and the plan calendar (holidays, weekly offs). */
export async function fyCalendar(db: Db | Tx, companyId: string, fy?: number) {
  const c = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  const startMonth = c.fyStartMonth ?? 4;
  const today = localDate(new Date(), c.timezone);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const year = fy ?? (m >= startMonth ? y : y - 1);
  const cal = await companyCalendar(db, companyId);
  const fyStart = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const plan: PlanCalendar = { fyStart, holidays: cal.holidays, workingWeekdays: cal.workingWeekdays };
  return {
    fy: year,
    fyStart,
    today,
    tz: c.timezone,
    cal: plan,
    isWorking: (d: string) =>
      !cal.holidays.has(d) && cal.workingWeekdays.has(new Date(`${d}T00:00:00Z`).getUTCDay() || 7),
  };
}

/** Who someone is to the CRM: their seats, and whether they see everyone (admins, the owner, the CRM seat). */
export async function crmRole(db: Db | Tx, actor: Actor) {
  const config = await crmConfigOf(db, actor.companyId);
  const seats = (Object.entries(config.seats) as [Seat, string[]][])
    .filter(([, ids]) => ids.includes(actor.userId))
    .map(([s]) => s);
  const all =
    can(actor, 'crm.admin') ||
    can(actor, 'crm.edit') ||
    seats.some((s) => s === 'owner' || s === 'crm' || s === 'mis') ||
    (await isOwner(db, actor));
  return { config, seats, all };
}
