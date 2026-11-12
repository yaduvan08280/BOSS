import type { Db } from '@mono/db';
import { addDays, financialYear, flowFieldMap, localDate, mergeData, weekOf, zonedToUtc } from '@mono/shared';
import type { Actor } from '../work/actor';
import { parseDefinition } from './engine';
import { dayRange } from './queries';
import { pathReaders } from './show';

type Period = 'TODAY' | 'WEEK' | 'MONTH' | 'FY';
const addDaysUtc = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/**
 * KPI cards: each card's value this period and the period before. A card reads `count`, a start-form value
 * (`start:<path>`) or a step's value (`step:<stepKey>:<path>`); the path may be a plain field (numbers, amounts,
 * formulas, item lines as their total) or a column of a linked row (`start:item.rate`), read through the link.
 */
export async function kpiValues(db: Db, actor: Actor, flowId: string) {
  const cards = await db.kpiCard.findMany({
    where: { companyId: actor.companyId, flowId },
    orderBy: { position: 'asc' },
  });
  if (!cards.length) return [];
  const { tz, fyStart } = await dayRange(db, actor.companyId);
  const now = new Date();
  const range = (p: Period, back: 0 | 1): [Date, Date] => {
    const today = localDate(now, tz);
    if (p === 'TODAY')
      return [zonedToUtc(addDays(today, -back), 0, tz), zonedToUtc(addDays(today, 1 - back), 0, tz)];
    if (p === 'WEEK') {
      const w = weekOf(now, tz);
      return [addDaysUtc(w.from, -7 * back), addDaysUtc(w.to, -7 * back)];
    }
    if (p === 'MONTH') {
      const [y, m] = today.split('-').map(Number) as [number, number];
      const start = (yy: number, mm: number) =>
        `${yy + Math.floor((mm - 1) / 12)}-${String(((((mm - 1) % 12) + 12) % 12) + 1).padStart(2, '0')}-01`;
      return [zonedToUtc(start(y, m - back), 0, tz), zonedToUtc(start(y, m - back + 1), 0, tz)];
    }
    const fy = financialYear(now, tz, fyStart);
    const s = `${fy.start - back}-${String(fyStart).padStart(2, '0')}-01`;
    const e = `${fy.start - back + 1}-${String(fyStart).padStart(2, '0')}-01`;
    return [zonedToUtc(s, 0, tz), zonedToUtc(e, 0, tz)];
  };
  const [records, flow] = await Promise.all([
    db.fmsRecord.findMany({
      where: {
        companyId: actor.companyId,
        flowId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        startedAt: { gte: range('FY', 1)[0] },
      },
      select: {
        startedAt: true,
        data: true,
        steps: { where: { status: 'DONE' }, select: { stepKey: true, doneAt: true, data: true } },
      },
    }),
    db.flow.findFirst({
      where: { id: flowId, companyId: actor.companyId },
      select: { draft: true, currentVersionId: true },
    }),
  ]);
  const version = flow?.currentVersionId
    ? await db.flowVersion.findUnique({ where: { id: flow.currentVersionId }, select: { definition: true } })
    : null;
  const fields = flowFieldMap(parseDefinition(version?.definition ?? flow?.draft));

  // One sample per value a card can read: when it happened, and the data it sits in (with its links).
  type Sample = { at: Date; data: unknown; where: string };
  const samples: Sample[] = [];
  for (const r of records) {
    samples.push({ at: r.startedAt, data: r.data, where: 'start' });
    for (const s of r.steps)
      if (s.doneAt)
        // A step's linked column may hang on a link the start form made: the record's own data is underneath.
        samples.push({ at: s.doneAt, data: mergeData(r.data, s.data), where: `step:${s.stepKey}` });
  }
  const pathOf = (source: string) =>
    source.startsWith('start:') ? source.slice(6) : source.split(':').slice(2).join(':');
  const paths = [...new Set(cards.filter((c) => c.source !== 'count').map((c) => pathOf(c.source)))];
  const readers = await pathReaders(
    db,
    actor.companyId,
    tz,
    fields,
    samples.map((s) => s.data),
    paths,
  );

  const value = (source: string, agg: string, [a, b]: [Date, Date]) => {
    const where =
      source === 'count' || source.startsWith('start:') ? 'start' : source.split(':').slice(0, 2).join(':');
    const path = source === 'count' ? null : pathOf(source);
    const nums: number[] = [];
    let count = 0;
    samples.forEach((s, i) => {
      if (s.where !== where || s.at < a || s.at >= b) return;
      if (!path) {
        count++;
        return;
      }
      const raw = readers[i]!.raw(path);
      if (raw === undefined || raw === null || raw === '') return;
      count++;
      const n = readers[i]!.number(path);
      if (n !== null) nums.push(n);
    });
    if (agg === 'COUNT' || !path) return count;
    if (!nums.length) return null;
    const total = nums.reduce((x, y) => x + y, 0);
    const v =
      agg === 'TOTAL'
        ? total
        : agg === 'AVERAGE'
          ? total / nums.length
          : agg === 'MIN'
            ? Math.min(...nums)
            : Math.max(...nums);
    return Math.round(v * 100) / 100;
  };
  return cards.map((c) => ({
    ...c,
    value: value(c.source, c.aggregation, range(c.period as Period, 0)),
    previous: value(c.source, c.aggregation, range(c.period as Period, 1)),
  }));
}
