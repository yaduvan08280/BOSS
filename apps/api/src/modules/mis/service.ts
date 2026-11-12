import { currentReach, type Db } from '@mono/db';
import { formatDate, misRow, weekOf, type MisRow } from '@mono/shared';
import { renderPdf } from '../../lib/pdf';
import { effectiveVerifier } from '../delegation/service';
import { weekSteps } from '../fms/people-report';
import { can, teamOf, type Actor } from '../work/actor';
import { moduleSettings } from '../work/settings';

export type MisPerson = MisRow & { name: string; department: string | null };

/** Who a person may see in the MIS: everyone (admins), their team plus themselves (HODs), or themselves. */
async function peopleFor(db: Db, actor: Actor) {
  const all = can(actor, 'core.admin');
  const team = all ? [] : await teamOf(db, actor.companyId, actor.userId);
  const branches = currentReach()?.branchIds ?? null;
  return db.user.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      status: 'ACTIVE',
      ...(all ? {} : { id: { in: [...team, actor.userId] } }),
      // Inside the reader's branches (phase 12): an area manager's MIS, or the switcher set to one outlet.
      ...(branches ? { OR: [{ branchId: { in: branches } }, { id: actor.userId }] } : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, mainDepartment: { select: { name: true } } },
  });
}

/** One week of MIS for the given people (CLAUDE.md §5.6). */
export async function misFor(
  db: Db,
  companyId: string,
  people: { id: string; name: string; mainDepartment: { name: string } | null }[],
  at: Date,
  now = new Date(),
) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const week = weekOf(at, company.timezone);
  const ids = people.map((p) => p.id);
  const s = await moduleSettings(db, companyId, 'delegation');
  const range = { gte: week.from, lt: week.to };
  const [tasks, runs, tickets, steps] = await Promise.all([
    db.task.findMany({
      where: {
        companyId,
        deletedAt: null,
        OR: [{ doerId: { in: ids }, plannedAt: range }, { doneAt: range }],
      },
      select: {
        doerId: true,
        verifierId: true,
        creatorId: true,
        status: true,
        plannedAt: true,
        doneAt: true,
        verifiedAt: true,
      },
    }),
    db.checklistRun.findMany({
      where: { companyId, doerId: { in: ids }, plannedAt: range, master: { deletedAt: null } },
      select: { doerId: true, plannedAt: true, status: true },
    }),
    db.ticket.findMany({
      where: { companyId, deletedAt: null, solverId: { in: ids }, plannedFixAt: range },
      select: { solverId: true, status: true, plannedFixAt: true, resolvedAt: true },
    }),
    weekSteps(db, companyId, ids, week),
  ]);
  const scored = tasks.map((t) => ({ ...t, verifierId: effectiveVerifier(t, s) }));
  const rows: MisPerson[] = people.map((p) => ({
    ...misRow(p.id, { tasks: scored, runs, tickets, steps }, week, now, s.verifyWithinMinutes),
    name: p.name,
    department: p.mainDepartment?.name ?? null,
  }));
  return { week: { start: week.start, end: week.end }, timezone: company.timezone, rows };
}

export async function misReport(db: Db, actor: Actor, at: Date) {
  const people = await peopleFor(db, actor);
  return misFor(db, actor.companyId, people, at);
}

const cell = (p: { pct: number | null; good: number; total: number } | null) =>
  !p || p.pct === null ? '—' : `${p.pct}% (${p.good}/${p.total})`;

/** The same table as the screen, as a landscape A4 PDF. */
export async function misPdf(
  report: Awaited<ReturnType<typeof misFor>>,
  companyName: string,
  appName: string,
) {
  const head = [
    'Person',
    'Department',
    'Tasks',
    'Done',
    'On time',
    'Verified in time',
    'Checklists',
    'Tickets',
    'FMS steps',
    'Score',
  ];
  const body = report.rows.map((r) => [
    { text: r.name, bold: true },
    r.department ?? '—',
    String(r.tasks.planned),
    cell(r.tasks.done),
    cell(r.tasks.onTime),
    cell(r.verifications),
    cell(r.checklists),
    cell(r.tickets),
    cell(r.fms),
    { text: r.score === null ? '—' : `${r.score}%`, bold: true },
  ]);
  const range = `${formatDate(`${report.week.start}T12:00:00Z`, 'UTC')} – ${formatDate(`${report.week.end}T12:00:00Z`, 'UTC')}`;
  return renderPdf({
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 36, 28, 36],
    info: { title: `Weekly MIS ${report.week.start}`, creator: appName },
    content: [
      { text: `${companyName} · Weekly MIS`, fontSize: 16, bold: true },
      { text: range, color: '#666', margin: [0, 2, 0, 12] },
      {
        table: {
          headerRows: 1,
          widths: ['*', 76, 34, 58, 58, 66, 58, 58, 58, 40],
          body: [head.map((h) => ({ text: h, bold: true, fillColor: '#f2efe7' })), ...body],
        },
        layout: 'lightHorizontalLines',
      },
      {
        text: '% of what was due that week (up to now for the current week). FMS steps: on time, each counted once — in the week done, or while open in the week due.',
        color: '#888',
        fontSize: 8,
        margin: [0, 10, 0, 0],
      },
    ],
  });
}
