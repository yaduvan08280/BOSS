import type { Db } from '@mono/db';
import { addDays, localDate } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { verifyLogin } from '../auth/service';
import type { Actor } from '../work/actor';
import { needOwner, num, pct } from './core';

/** One company's morning in numbers: yesterday's money and people, and what is waiting right now. */
async function morningOf(db: Db, companyId: string) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { id: true, name: true, timezone: true },
  });
  const today = localDate(new Date(), company.timezone);
  const yesterday = addDays(today, -1);
  const now = new Date();
  const [pos, orders, att, overdue, missed, red, posDays, escalated, lateSteps] = await Promise.all([
    db.posCheck.aggregate({
      where: { companyId, businessDay: yesterday, status: { not: 'CANCELLED' } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.salesOrder.aggregate({
      where: { companyId, orderDate: yesterday, status: { not: 'CANCELLED' } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.attendanceDay.groupBy({
      by: ['status'],
      where: { companyId, date: yesterday },
      _count: { _all: true },
    }),
    db.task.count({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] },
        plannedAt: { lt: now },
      },
    }),
    db.checklistRun.count({
      where: {
        companyId,
        status: 'MISSED',
        plannedAt: { gte: new Date(now.getTime() - 36 * 3_600_000) },
        master: { deletedAt: null },
      },
    }),
    db.item.count({ where: { companyId, deletedAt: null, active: true, band: 'red' } }),
    db.posDay.findMany({ where: { companyId, businessDay: yesterday }, select: { report: true } }),
    db.ticket.count({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        escalationLevel: { gt: 0 },
      },
    }),
    db.fmsRecordStep.count({
      where: {
        companyId,
        status: 'OPEN',
        type: { not: 'AUTO' },
        plannedAt: { lt: now },
        record: { status: 'RUNNING', deletedAt: null },
      },
    }),
  ]);
  const count = (st: string[]) =>
    att.filter((a) => st.includes(a.status)).reduce((n, a) => n + a._count._all, 0);
  const due = count(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT']);
  const cashDiff = posDays.reduce(
    (n, d) => n + num((d.report as { difference?: number } | null)?.difference),
    0,
  );
  const attendancePct = pct(count(['PRESENT', 'LATE']) + count(['HALF_DAY']) / 2, due);
  // What needs the owner's eye first, in plain words, with how bad it is (for one list across companies).
  const flags: { key: string; n: number; weight: number }[] = [];
  const flag = (key: string, n: number, weight: number) =>
    n > 0 && flags.push({ key, n, weight: weight * n });
  flag('cashShort', cashDiff < 0 ? Math.round(-cashDiff / 100) : 0, 1);
  flag('overdue', overdue, 30);
  flag('lateSteps', lateSteps, 40);
  flag('missed', missed, 60);
  flag('escalated', escalated, 80);
  flag('red', red, 20);
  flag('absent', count(['ABSENT']), 25);
  return {
    companyId: company.id,
    name: company.name,
    day: yesterday,
    sales: num(pos._sum.total) + num(orders._sum.amount),
    bills: pos._count._all + orders._count._all,
    cashDiff,
    attendancePct,
    absent: count(['ABSENT']),
    overdue,
    lateSteps,
    missed,
    escalated,
    red,
    flags: flags.sort((a, b) => b.weight - a.weight),
  };
}

/**
 * The owner's morning page: this company and every other company the same person has linked, side by side,
 * with one worst-first list across all of them. Another company is read only through a link its owner made by
 * signing in to it from here.
 */
export async function morning(db: Db, actor: Actor) {
  needOwner(actor);
  const links = await db.ownerLink.findMany({ where: { companyId: actor.companyId, userId: actor.userId } });
  const live = [];
  for (const l of links) {
    // The link holds only while the other login is still an active owner there.
    const other = await db.user.findFirst({
      where: {
        id: l.otherUserId,
        companyId: l.otherCompanyId,
        deletedAt: null,
        status: 'ACTIVE',
        loginEnabled: true,
        role: { key: 'OWNER' },
        company: { deletedAt: null },
      },
      select: { id: true },
    });
    if (other) live.push(l.otherCompanyId);
  }
  const companies = [];
  for (const id of [actor.companyId, ...live])
    companies.push({ ...(await morningOf(db, id)), mine: id === actor.companyId });
  const worst = companies
    .flatMap((c) => c.flags.map((f) => ({ company: c.name, ...f })))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12);
  return { companies, worst, linked: live.length };
}

/** Link another company you own: prove it by that company's own sign-in (it must be an Owner there). */
export async function linkCompany(
  db: Db,
  actor: Actor,
  input: { identifier: string; password: string; companyId?: string },
) {
  needOwner(actor);
  const me = await db.user.findFirstOrThrow({
    where: { id: actor.userId },
    select: { role: { select: { key: true } } },
  });
  if (me.role.key !== 'OWNER') throw new AppError(403, 'FORBIDDEN', 'Only an Owner links companies');
  const found = await verifyLogin(db, input.identifier, input.password, input.companyId);
  const other = await db.user.findFirstOrThrow({
    where: { id: found.id },
    select: {
      id: true,
      companyId: true,
      role: { select: { key: true } },
      company: { select: { name: true } },
    },
  });
  if (other.companyId === actor.companyId) throw new AppError(400, 'BAD_REQUEST', 'That is this company');
  if (other.role.key !== 'OWNER')
    throw new AppError(403, 'FORBIDDEN', 'You must be an Owner of the other company to link it');
  await db.ownerLink.upsert({
    where: { userId_otherCompanyId: { userId: actor.userId, otherCompanyId: other.companyId } },
    create: {
      companyId: actor.companyId,
      userId: actor.userId,
      otherCompanyId: other.companyId,
      otherUserId: other.id,
    },
    update: { otherUserId: other.id },
  });
  await db.auditLog.create({
    data: {
      companyId: actor.companyId,
      actorId: actor.userId,
      action: 'owner.company_linked',
      entityType: 'company',
      entityId: other.companyId,
      after: { name: other.company.name },
    },
  });
  return { ok: true, name: other.company.name };
}

export async function unlinkCompany(db: Db, actor: Actor, otherCompanyId: string) {
  needOwner(actor);
  await db.ownerLink.deleteMany({
    where: { companyId: actor.companyId, userId: actor.userId, otherCompanyId },
  });
  return { ok: true };
}
