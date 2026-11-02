import type { Db } from '@mono/db';
import { addDays, localDate, zonedToUtc } from '@mono/shared';
import { effectiveVerifier } from '../delegation/service';
import { moduleSettings } from './settings';

/** "My pending work": tasks to accept/do/verify + checklists due today (or overdue) and to verify. */
export async function pendingCounts(db: Db, companyId: string, userId: string) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const endOfToday = zonedToUtc(addDays(localDate(new Date(), company.timezone), 1), 0, company.timezone);
  const s = await moduleSettings(db, companyId, 'delegation');
  const [doing, verifying, runs, runsToVerify] = await Promise.all([
    db.task.count({
      where: { companyId, deletedAt: null, doerId: userId, status: { in: ['AWAITING_ACCEPTANCE', 'OPEN'] } },
    }),
    db.task.findMany({
      where: { companyId, deletedAt: null, status: 'PENDING_VERIFY' },
      select: { verifierId: true, creatorId: true, doerId: true },
    }),
    db.checklistRun.count({
      where: {
        companyId,
        doerId: userId,
        status: 'OPEN',
        plannedAt: { lt: endOfToday },
        master: { deletedAt: null },
      },
    }),
    db.checklistRun.count({
      where: { companyId, verifierId: userId, status: 'PENDING_VERIFY', master: { deletedAt: null } },
    }),
  ]);
  const toVerify = verifying.filter((t) => effectiveVerifier(t, s) === userId).length;
  return {
    delegation: doing + toVerify,
    checklists: runs + runsToVerify,
    total: doing + toVerify + runs + runsToVerify,
  };
}
