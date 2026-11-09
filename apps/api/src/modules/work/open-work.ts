import type { Db } from '@mono/db';
import { forbidden, notFound } from '../../lib/errors';
import { can, teamOf, type Actor } from './actor';

export type OpenWorkItem = {
  kind: 'task' | 'checklist' | 'fms' | 'ticket';
  id: string;
  title: string;
  due: string;
  late: boolean;
  /** Where the item opens in the web app. */
  link: string;
};

const LIST = 8;

/**
 * Everything a person still has to do (org chart → person): open tasks, checklist runs, FMS steps and
 * help tickets they solve. Admins may look at anyone, HODs at their team, everyone else only at themselves.
 */
export async function personOpenWork(db: Db, actor: Actor, personId: string, now = new Date()) {
  const companyId = actor.companyId;
  const person = await db.user.findFirst({
    where: { id: personId, companyId, deletedAt: null },
    select: { id: true },
  });
  if (!person) throw notFound('Person');
  if (
    personId !== actor.userId &&
    !can(actor, 'core.admin') &&
    !(await teamOf(db, companyId, actor.userId)).includes(personId)
  )
    throw forbidden("You can only see your own team's work");

  const [tasks, runs, steps, tickets] = await Promise.all([
    db.task.findMany({
      where: {
        companyId,
        deletedAt: null,
        doerId: personId,
        status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] },
      },
      select: { id: true, number: true, description: true, plannedAt: true },
    }),
    db.checklistRun.findMany({
      where: { companyId, doerId: personId, status: 'OPEN', master: { deletedAt: null } },
      select: { id: true, plannedAt: true, master: { select: { name: true } } },
    }),
    db.fmsRecordStep.findMany({
      where: {
        companyId,
        doerId: personId,
        status: 'OPEN',
        type: { not: 'AUTO' },
        record: { status: 'RUNNING', deletedAt: null },
      },
      select: {
        stepName: true,
        plannedAt: true,
        record: { select: { id: true, number: true, title: true, flowId: true } },
      },
    }),
    db.ticket.findMany({
      where: { companyId, deletedAt: null, solverId: personId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: { id: true, number: true, title: true, plannedFixAt: true },
    }),
  ]);

  const item = (kind: OpenWorkItem['kind'], id: string, title: string, due: Date, link: string) => ({
    kind,
    id,
    title,
    due: due.toISOString(),
    late: due < now,
    link,
  });
  const all: OpenWorkItem[] = [
    ...tasks.map((t) =>
      item(
        'task',
        t.id,
        `#${t.number} ${t.description.slice(0, 80)}`,
        t.plannedAt,
        `/delegation?task=${t.id}`,
      ),
    ),
    ...runs.map((r) => item('checklist', r.id, r.master.name, r.plannedAt, `/checklists?run=${r.id}`)),
    ...steps.map((s) =>
      item(
        'fms',
        s.record.id,
        `${s.stepName} · ${s.record.title} #${s.record.number}`,
        s.plannedAt,
        `/fms/live?flow=${s.record.flowId}&record=${s.record.id}`,
      ),
    ),
    ...tickets.map((t) =>
      item('ticket', t.id, `#${t.number} ${t.title}`, t.plannedFixAt, `/help-tickets?ticket=${t.id}`),
    ),
  ].sort((a, b) => a.due.localeCompare(b.due));

  const count = (kind: OpenWorkItem['kind']) => all.filter((i) => i.kind === kind).length;
  return {
    counts: {
      task: count('task'),
      checklist: count('checklist'),
      fms: count('fms'),
      ticket: count('ticket'),
    },
    total: all.length,
    late: all.filter((i) => i.late).length,
    // Late first (oldest first), then the next ones due.
    items: [...all.filter((i) => i.late), ...all.filter((i) => !i.late)].slice(0, LIST),
  };
}
