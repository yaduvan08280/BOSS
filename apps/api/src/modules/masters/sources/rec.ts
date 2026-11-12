import type { Db, Tx } from '@mono/db';
import { formatDate, localDate, makeRef, mergeData } from '@mono/shared';
import type { MasterOption, SourceHandler } from './index';

type Rec = {
  id: string;
  number: number;
  title: string;
  status: string;
  startedAt: Date;
  data: unknown;
  steps: { data: unknown; stepName: string; status: string }[];
};

/** How a record reads wherever it is picked or shown: `#12 · Sharma wedding · 14/12/2026` (decision 46). */
export const recordLabel = (r: Pick<Rec, 'number' | 'title' | 'startedAt'>, tz: string) =>
  `#${r.number} · ${r.title} · ${formatDate(r.startedAt, tz)}`;

export async function companyTz(db: Db | Tx, companyId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  return c?.timezone ?? 'Asia/Kolkata';
}

function toOption(r: Rec, tz: string): MasterOption {
  const done = r.steps.filter((s) => s.status === 'DONE');
  const at = r.steps.find((s) => s.status === 'OPEN');
  return {
    value: recordLabel(r, tz),
    label: recordLabel(r, tz),
    sub: at ? at.stepName : r.status === 'CLOSED' ? 'Closed' : r.status === 'ON_HOLD' ? 'On hold' : null,
    ref: makeRef('rec', r.id),
    // Everything entered on the record (start form, then each finished step), plus what MONO knows about it.
    columns: {
      ...mergeData(r.data, ...done.map((s) => s.data)),
      number: r.number,
      title: r.title,
      status: r.status,
      started: localDate(r.startedAt, tz),
    },
  };
}

/**
 * `rec:<flowId>` — pick a whole record of another flow. Cancelled and deleted records are never offered. The
 * field's `recFilter` narrows them: standing at a step, still running, started by the person, started in the
 * last N days. Search by number (`12`, `#12`) or by words of the title.
 */
export const recordSource: SourceHandler = async (db, actor, flowId, query) => {
  const companyId = actor.companyId;
  if (!flowId) return [];
  const f = query.rec ?? {};
  const q = query.q.trim();
  const number = /^#?\d{1,9}$/.test(q) ? Number(q.replace('#', '')) : null;
  const search = !q
    ? {}
    : {
        OR: [
          ...(number !== null ? [{ number }] : []),
          { title: { contains: q.replace(/^#/, ''), mode: 'insensitive' as const } },
        ],
      };
  const rows = await db.fmsRecord.findMany({
    where: {
      companyId,
      flowId,
      deletedAt: null,
      status: f.running ? 'RUNNING' : { not: 'CANCELLED' },
      ...(f.mine ? { startedById: actor.userId || '-' } : {}),
      ...(f.days ? { startedAt: { gte: new Date(Date.now() - f.days * 86_400_000) } } : {}),
      ...(f.step ? { steps: { some: { stepKey: f.step, status: 'OPEN' } } } : {}),
      ...(query.ids ? { id: { in: query.ids } } : search),
    },
    orderBy: { startedAt: 'desc' },
    take: query.limit,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      startedAt: true,
      data: true,
      steps: {
        where: { status: { in: ['DONE', 'OPEN'] } },
        orderBy: { doneAt: 'asc' },
        select: { data: true, stepName: true, status: true },
      },
    },
  });
  if (!rows.length) return [];
  const tz = await companyTz(db, companyId);
  return rows.map((r) => toOption(r, tz));
};
