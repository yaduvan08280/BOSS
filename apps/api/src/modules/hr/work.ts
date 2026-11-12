import type { Db, Tx } from '@mono/db';
import {
  flowDefinitionSchema,
  frequencySchema,
  occurrences,
  suggestBuddies,
  type HrRules,
} from '@mono/shared';
import { companyCalendar } from './calendar';
import type { HrPerson } from './people';

export type WorkItem = {
  key: string;
  entityType: 'task' | 'checklist' | 'fms_step';
  entityId: string;
  title: string;
  due: string | null;
  /** FMS steps: the backup doers set on the step */
  backups: string[];
};

const LIVE_TASK = ['OPEN', 'AWAITING_ACCEPTANCE'];

/**
 * A person's open work during a period (CLAUDE.md §9.2 "Buddy check"): tasks due before it ends (late ones too),
 * recurring checklists that fall due in it, and FMS steps they hold.
 */
export async function openWork(db: Db | Tx, p: HrPerson, from: Date, to: Date): Promise<WorkItem[]> {
  const [tasks, masters, steps] = await Promise.all([
    db.task.findMany({
      where: {
        companyId: p.companyId,
        deletedAt: null,
        doerId: p.id,
        status: { in: LIVE_TASK },
        plannedAt: { lt: to },
      },
      orderBy: { plannedAt: 'asc' },
      select: { id: true, number: true, description: true, plannedAt: true },
    }),
    db.checklistMaster.findMany({
      where: { companyId: p.companyId, deletedAt: null, active: true, doerIds: { has: p.id } },
    }),
    db.fmsRecordStep.findMany({
      where: {
        companyId: p.companyId,
        doerId: p.id,
        status: 'OPEN',
        record: { status: 'RUNNING', deletedAt: null },
      },
      select: {
        id: true,
        stepKey: true,
        stepName: true,
        plannedAt: true,
        record: {
          select: { title: true, number: true, flowVersionId: true, flow: { select: { name: true } } },
        },
      },
    }),
  ]);
  const cal = await companyCalendar(db, p.companyId, p.branchId);
  const items: WorkItem[] = tasks.map((t) => ({
    key: `task:${t.id}`,
    entityType: 'task',
    entityId: t.id,
    title: `#${t.number} ${t.description.slice(0, 80)}`,
    due: t.plannedAt.toISOString(),
    backups: [],
  }));
  for (const m of masters) {
    const freq = frequencySchema.safeParse(m.frequency);
    if (!freq.success) continue;
    const dues = occurrences(
      { frequency: freq.data, dueMin: m.dueMin, startDate: m.startDate, skipHolidays: m.skipHolidays },
      from,
      to,
      { tz: cal.tz, holidays: cal.holidays, workingWeekdays: cal.workingWeekdays },
    );
    if (dues.length)
      items.push({
        key: `checklist:${m.id}`,
        entityType: 'checklist',
        entityId: m.id,
        title: `${m.name} (${dues.length}×)`,
        due: dues[0]!.toISOString(),
        backups: [],
      });
  }
  const versions = new Map<string, ReturnType<typeof flowDefinitionSchema.parse>>();
  for (const s of steps) {
    const vid = s.record.flowVersionId;
    if (!versions.has(vid)) {
      const v = await db.flowVersion.findUnique({ where: { id: vid }, select: { definition: true } });
      const parsed = flowDefinitionSchema.safeParse(v?.definition);
      versions.set(vid, parsed.success ? parsed.data : flowDefinitionSchema.parse({}));
    }
    const def = versions.get(vid)!;
    items.push({
      key: `fms_step:${s.id}`,
      entityType: 'fms_step',
      entityId: s.id,
      title: `${s.record.flow.name} · ${s.record.title} · ${s.stepName}`,
      due: s.plannedAt.toISOString(),
      backups: def.steps.find((x) => x.key === s.stepKey)?.backupIds ?? [],
    });
  }
  return items;
}

/** People who can't be a Buddy for the period: away themselves, or already covering the most they may. */
export async function unavailable(
  db: Db | Tx,
  companyId: string,
  rules: HrRules,
  from: string,
  to: string,
  fromAt: Date,
  toAt: Date,
) {
  const [away, covers, asks] = await Promise.all([
    db.leaveRequest.findMany({
      where: { companyId, status: { in: ['PENDING', 'APPROVED'] }, from: { lte: to }, to: { gte: from } },
      select: { userId: true },
    }),
    db.cover.findMany({
      where: { companyId, status: { in: ['SCHEDULED', 'ACTIVE'] }, from: { lt: toAt }, to: { gt: fromAt } },
      select: { buddyUserId: true, originalUserId: true },
    }),
    db.buddyRequest.findMany({
      where: { companyId, status: { in: ['ASKED', 'ACCEPTED'] }, from: { lt: toAt }, to: { gt: fromAt } },
      select: { buddyId: true, userId: true },
    }),
  ]);
  const load = new Map<string, Set<string>>();
  for (const c of covers)
    load.set(c.buddyUserId, (load.get(c.buddyUserId) ?? new Set()).add(c.originalUserId));
  for (const a of asks) load.set(a.buddyId, (load.get(a.buddyId) ?? new Set()).add(a.userId));
  return {
    away: new Set(away.map((a) => a.userId)),
    /** Buddy → the people they already cover in the period */
    load,
    full: (id: string, person: string) => {
      const s = load.get(id);
      return Boolean(s && !s.has(person) && s.size >= rules.buddy.maxCover);
    },
  };
}

/** Ordered Buddy suggestions for each piece of work (§9.1 step 5), names included for the screen. */
export async function suggestionsFor(
  db: Db | Tx,
  p: HrPerson,
  rules: HrRules,
  items: WorkItem[],
  period: { from: string; to: string; fromAt: Date; toAt: Date },
) {
  const busy = await unavailable(db, p.companyId, rules, period.from, period.to, period.fromAt, period.toAt);
  const people = await db.user.findMany({
    where: { companyId: p.companyId, deletedAt: null, status: 'ACTIVE', NOT: { id: p.id } },
    select: {
      id: true,
      name: true,
      mainDepartmentId: true,
      branchId: true,
      designation: { select: { name: true } },
    },
  });
  const byId = new Map(people.map((u) => [u.id, u]));
  // Least busy first within the department: fewest open tasks.
  const openCounts = new Map(
    (
      await db.task.groupBy({
        by: ['doerId'],
        where: { companyId: p.companyId, deletedAt: null, status: { in: LIVE_TASK } },
        _count: true,
      })
    ).map((g) => [g.doerId, g._count]),
  );
  // "A free person in the same department" — the HOD has their own place in the order.
  const sameDept = people
    .filter((u) => p.departmentId && u.mainDepartmentId === p.departmentId && u.id !== p.hodId)
    .sort((a, b) => (openCounts.get(a.id) ?? 0) - (openCounts.get(b.id) ?? 0))
    .map((u) => u.id);
  const skip = new Set([p.id, ...busy.away, ...people.filter((u) => busy.full(u.id, p.id)).map((u) => u.id)]);
  // "Buddy can be from another department: No" keeps everyone but the HOD inside the department.
  const allowed = (id: string) =>
    rules.buddy.otherDepartment || id === p.hodId || byId.get(id)?.mainDepartmentId === p.departmentId;
  for (const id of byId.keys()) if (!allowed(id)) skip.add(id);
  // "Buddy from another branch: No" keeps cover inside the person's own branch (phase 12).
  if (!rules.buddy.otherBranch && p.branchId)
    for (const u of people) if (u.branchId !== p.branchId) skip.add(u.id);
  return items.map((it) => {
    const ids = suggestBuddies(
      rules.buddyAnswer.order,
      { fmsBackup: it.backups, defaultBuddy: p.defaultBuddyId, sameDepartment: sameDept, hod: p.hodId },
      skip,
    ).filter((id) => byId.has(id));
    return {
      ...it,
      suggestions: ids.slice(0, 6).map((id) => ({
        id,
        name: byId.get(id)!.name,
        designation: byId.get(id)!.designation?.name ?? null,
      })),
    };
  });
}
