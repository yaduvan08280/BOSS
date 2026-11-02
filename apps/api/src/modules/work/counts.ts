import type { Db } from '@mono/db';
import { addDays, localDate, zonedToUtc } from '@mono/shared';
import { effectiveVerifier } from '../delegation/service';
import { moduleSettings } from './settings';

/** "My pending work": tasks, checklists due today, slips and tickets waiting on me, and the EA's captures to sort. */
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
  const [slipS, eaS] = await Promise.all([
    moduleSettings(db, companyId, 'slip'),
    moduleSettings(db, companyId, 'ea'),
  ]);
  const base = { companyId, deletedAt: null };
  const [slips, tickets, ea] = await Promise.all([
    // Slips waiting on me: to screen, to decide, to fix and resubmit, or to close.
    db.slip.count({
      where: {
        ...base,
        OR: [
          { status: 'SUBMITTED', receiverId: userId },
          ...(slipS.approverStep ? [{ status: 'WITH_APPROVER', approverId: userId }] : []),
          { status: { in: ['RETURNED', 'APPROVED', 'REJECTED'] }, raiserId: userId },
        ],
      },
    }),
    // Tickets to fix, and fixed ones waiting for my confirmation.
    db.ticket.count({
      where: {
        ...base,
        OR: [
          { solverId: userId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          { raiserId: userId, status: 'RESOLVED' },
        ],
      },
    }),
    // The EA's inbox: captures still to sort.
    eaS.eaUserId === userId ? db.eaItem.count({ where: { ...base, stage: 'CAPTURED' } }) : Promise.resolve(0),
  ]);
  const delegation = doing + toVerify;
  const checklists = runs + runsToVerify;
  return {
    delegation,
    checklists,
    slips,
    tickets,
    ea,
    total: delegation + checklists + slips + tickets + ea,
  };
}
