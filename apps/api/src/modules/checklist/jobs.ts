import type { Db, Prisma } from '@mono/db';
import { checklistMachine, frequencySchema, localDate, addDays, occurrences, transition } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { moduleSettings } from '../work/settings';
import type { Item } from './service';

const LEAD_MS = 24 * 3600_000;

/**
 * checklist.sweep (every 5 minutes): create the runs that are due within the next 24 h.
 * Idempotent: one run per (master, due time, doer) thanks to the unique key.
 */
export async function sweepChecklists(db: Db, now = new Date(), onlyMasterId?: string): Promise<number> {
  const masters = await db.checklistMaster.findMany({
    where: { active: true, deletedAt: null, ...(onlyMasterId ? { id: onlyMasterId } : {}) },
  });
  const byCompany = new Map<string, typeof masters>();
  for (const m of masters) byCompany.set(m.companyId, [...(byCompany.get(m.companyId) ?? []), m]);
  let created = 0;
  for (const [companyId, list] of byCompany) {
    const company = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    });
    const settings = await moduleSettings(db, companyId, 'checklist');
    const shift = await db.shift.findFirst({
      where: { companyId, isDefault: true, deletedAt: null },
      select: { weekdays: true },
    });
    const today = localDate(now, company.timezone);
    const holidays = await db.holiday.findMany({
      where: {
        companyId,
        deletedAt: null,
        branchId: null,
        date: { gte: addDays(today, -3), lte: addDays(today, 3) },
      },
      select: { date: true },
    });
    const cal = {
      tz: company.timezone,
      holidays: new Set(holidays.map((h) => h.date)),
      workingWeekdays: new Set(shift?.weekdays.length ? shift.weekdays : [1, 2, 3, 4, 5, 6, 7]),
    };

    for (const m of list) {
      const freq = frequencySchema.safeParse(m.frequency);
      if (!freq.success) continue;
      const windowMs = m.windowHours * 3600_000;
      const dues = occurrences(
        { frequency: freq.data, dueMin: m.dueMin, startDate: m.startDate, skipHolidays: m.skipHolidays },
        new Date(now.getTime() - windowMs),
        new Date(now.getTime() + LEAD_MS),
        cal,
      );
      const items = m.items as unknown as Item[];
      for (const due of dues) {
        for (const doerId of m.doerIds) {
          try {
            await db.$transaction(async (tx) => {
              const run = await tx.checklistRun.create({
                data: {
                  companyId,
                  masterId: m.id,
                  doerId,
                  verifierId: m.verifierId ?? settings.verifierUserId,
                  plannedAt: due,
                  windowEndsAt: new Date(due.getTime() + windowMs),
                  itemsTotal: items.length,
                  items: {
                    create: items.map((it, i) => ({
                      companyId,
                      itemKey: it.key,
                      text: it.text,
                      sortOrder: i,
                      requirePhoto: it.requirePhoto,
                      requireVoice: it.requireVoice,
                      requireValue: it.requireValue,
                    })),
                  },
                },
              });
              await emitEvent(
                tx,
                { companyId, actorId: null },
                {
                  name: 'checklist.assigned',
                  entityType: 'checklist_run',
                  entityId: run.id,
                  payload: {
                    doerId,
                    checklist: m.name,
                    due: due.toISOString(),
                    link: `/checklists?run=${run.id}`,
                  },
                },
              );
            });
            created++;
          } catch (err) {
            if ((err as Prisma.PrismaClientKnownRequestError).code !== 'P2002') throw err;
          }
        }
      }
    }
  }
  return created;
}

/** Runs still open after their window: auto-closed as MISSED (the owner hears about it through the rules). */
export async function expireChecklists(db: Db, now = new Date()): Promise<number> {
  const late = await db.checklistRun.findMany({
    where: { status: 'OPEN', windowEndsAt: { lt: now }, master: { deletedAt: null } },
    include: { master: { select: { name: true } } },
    take: 200,
  });
  for (const run of late) {
    transition(checklistMachine, {
      from: 'OPEN',
      action: 'expire',
      roles: ['system'],
      ctx: { verifierStep: false, hasVerifier: false, allItemsDone: false },
    });
    await db.$transaction(async (tx) => {
      const res = await tx.checklistRun.updateMany({
        where: { id: run.id, status: 'OPEN' },
        data: { status: 'MISSED' },
      });
      if (!res.count) return;
      await emitEvent(
        tx,
        { companyId: run.companyId, actorId: null },
        {
          name: 'checklist.missed',
          entityType: 'checklist_run',
          entityId: run.id,
          payload: {
            doerId: run.doerId,
            checklist: run.master.name,
            due: run.plannedAt.toISOString(),
            link: `/checklists?run=${run.id}`,
          },
        },
      );
    });
  }
  return late.length;
}

/** One reminder per run, `remindBeforeMinutes` before it is due. */
export async function remindChecklists(db: Db, now = new Date()): Promise<number> {
  const open = await db.checklistRun.findMany({
    where: { status: 'OPEN', remindedAt: null, windowEndsAt: { gt: now }, master: { deletedAt: null } },
    include: { master: { select: { name: true } } },
    take: 500,
  });
  let sent = 0;
  const settingsCache = new Map<string, number>();
  for (const run of open) {
    let before = settingsCache.get(run.companyId);
    if (before === undefined) {
      before = (await moduleSettings(db, run.companyId, 'checklist')).remindBeforeMinutes;
      settingsCache.set(run.companyId, before);
    }
    if (run.plannedAt.getTime() - before * 60_000 > now.getTime()) continue;
    await db.$transaction(async (tx) => {
      const res = await tx.checklistRun.updateMany({
        where: { id: run.id, remindedAt: null },
        data: { remindedAt: now },
      });
      if (!res.count) return;
      await emitEvent(
        tx,
        { companyId: run.companyId, actorId: null },
        {
          name: 'checklist.reminder',
          entityType: 'checklist_run',
          entityId: run.id,
          payload: {
            doerId: run.doerId,
            checklist: run.master.name,
            due: run.plannedAt.toISOString(),
            progress: `${run.itemsDone}/${run.itemsTotal}`,
            link: `/checklists?run=${run.id}`,
          },
        },
      );
    });
    sent++;
  }
  return sent;
}
