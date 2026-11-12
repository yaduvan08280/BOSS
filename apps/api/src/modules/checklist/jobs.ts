import type { Db, Prisma } from '@mono/db';
import { checklistMachine, frequencySchema, occurrences, transition } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { companyCalendar } from '../hr/calendar';
import { checklistCovers } from '../hr/cover';
import { moduleSettings } from '../work/settings';
import type { Item } from './service';
import { homeBranchOf } from '../branches/reach';

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
    // The shared calendar: holidays and weekly offs (or the default shift's days when none are set).
    const shared = await companyCalendar(db, companyId);
    const cal = { tz: company.timezone, holidays: shared.holidays, workingWeekdays: shared.workingWeekdays };
    // A run that falls while its doer is away goes to their Buddy.
    const buddyFor = await checklistCovers(db, companyId);

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
        for (const owner of m.doerIds) {
          const buddy = buddyFor(m.id, owner, due);
          const doerId = buddy ?? owner;
          try {
            await db.$transaction(async (tx) => {
              const run = await tx.checklistRun.create({
                data: {
                  companyId,
                  // The template's branch, else the branch of the person whose run it is (phase 12).
                  branchId: m.branchId ?? (await homeBranchOf(tx, companyId, owner)),
                  masterId: m.id,
                  doerId,
                  coveredById: buddy,
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
  const tellOwner = new Map<string, boolean>();
  for (const run of late) {
    if (!tellOwner.has(run.companyId))
      tellOwner.set(
        run.companyId,
        (await moduleSettings(db, run.companyId, 'checklist')).tellOwnerAboutMisses,
      );
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
            ...(tellOwner.get(run.companyId) ? {} : { skipRecipients: ['owner'] }),
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
