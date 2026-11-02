/**
 * Delegation reports (CLAUDE.md §5.1): the R/Y/G grade of each task and the weekly KRA/KPI scorecard.
 * Pure functions on plain task rows, so they are unit-tested with fixed dates.
 */
export type ScoredTask = {
  doerId: string;
  verifierId: string | null;
  status: string;
  plannedAt: Date;
  doneAt: Date | null;
  verifiedAt: Date | null;
  revisionCount: number;
};

export type Grade = 'GREEN' | 'YELLOW' | 'RED' | 'OPEN';
const DAY = 86_400_000;

/** Whole days late (a few hours late counts as 1 day), measured to done time or to now. */
export function daysLate(t: Pick<ScoredTask, 'plannedAt' | 'doneAt'>, now: Date): number {
  const end = t.doneAt ?? now;
  const late = end.getTime() - t.plannedAt.getTime();
  return late <= 0 ? 0 : Math.ceil(late / DAY);
}

/**
 * Green = done on time with no revision. Yellow = a day late or revised once.
 * Red = two or more days late, or revised twice or more. Open = still running and not late. Cancelled = not graded.
 */
export function gradeTask(t: ScoredTask, now: Date): Grade | null {
  if (t.status === 'CANCELLED') return null;
  const late = daysLate(t, now);
  const done = Boolean(t.doneAt);
  if (!done && late === 0) return 'OPEN';
  if (late >= 2 || t.revisionCount >= 2) return 'RED';
  if (late === 1 || t.revisionCount === 1) return 'YELLOW';
  return 'GREEN';
}

export type RygRow = {
  personId: string;
  total: number;
  green: number;
  yellow: number;
  red: number;
  open: number;
  pctGreen: number;
  pctYellow: number;
  pctRed: number;
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export function rygReport(tasks: ScoredTask[], now: Date): RygRow[] {
  const rows = new Map<string, RygRow>();
  for (const t of tasks) {
    const g = gradeTask(t, now);
    if (!g) continue;
    const r = rows.get(t.doerId) ?? {
      personId: t.doerId,
      total: 0,
      green: 0,
      yellow: 0,
      red: 0,
      open: 0,
      pctGreen: 0,
      pctYellow: 0,
      pctRed: 0,
    };
    r.total++;
    if (g === 'GREEN') r.green++;
    else if (g === 'YELLOW') r.yellow++;
    else if (g === 'RED') r.red++;
    else r.open++;
    rows.set(t.doerId, r);
  }
  for (const r of rows.values()) {
    const graded = r.green + r.yellow + r.red;
    r.pctGreen = pct(r.green, graded);
    r.pctYellow = pct(r.yellow, graded);
    r.pctRed = pct(r.red, graded);
  }
  return [...rows.values()];
}

export const KPI_KEYS = ['notDone', 'notOnTime', 'verifyPending', 'verifyLate'] as const;
export type KpiKey = (typeof KPI_KEYS)[number];
export type KpiState = 'meets' | 'off' | 'missedTwice' | 'noData';

type Measure = { planned: number; due: number; actual: number; pct: number | null };

export type ScoreLine = {
  kpi: KpiKey;
  benchmark: number;
  lastWeekPct: number | null;
  planned: number;
  actual: number;
  actualPct: number | null;
  nextTarget: number;
  state: KpiState;
};

/**
 * One KPI for one person in one week. Graded = due by the cut-off (now, for the current week)
 * or already finished — work done early counts straight away instead of waiting for its date.
 */
function measure(
  kpi: KpiKey,
  personId: string,
  tasks: ScoredTask[],
  from: Date,
  to: Date,
  now: Date,
  slaMs: number,
): Measure {
  const cutoff = new Date(Math.min(to.getTime(), now.getTime()));
  const live = tasks.filter((t) => t.status !== 'CANCELLED');
  if (kpi === 'notDone' || kpi === 'notOnTime') {
    const mine = live.filter((t) => t.doerId === personId && t.plannedAt >= from && t.plannedAt < to);
    const due = mine.filter((t) => t.plannedAt <= cutoff || (t.doneAt && t.doneAt <= cutoff));
    const bad =
      kpi === 'notDone'
        ? due.filter((t) => !t.doneAt || t.doneAt > cutoff)
        : due.filter((t) => !t.doneAt || t.doneAt > t.plannedAt);
    return {
      planned: mine.length,
      due: due.length,
      actual: bad.length,
      pct: due.length ? pct(bad.length, due.length) : null,
    };
  }
  // Verifications: tasks this person had to verify that were handed in during the week.
  const mine = live.filter((t) => t.verifierId === personId && t.doneAt && t.doneAt >= from && t.doneAt < to);
  const bad =
    kpi === 'verifyPending'
      ? mine.filter((t) => !t.verifiedAt || t.verifiedAt > cutoff)
      : mine.filter((t) => {
          const limit = t.doneAt!.getTime() + slaMs;
          return t.verifiedAt ? t.verifiedAt.getTime() > limit : cutoff.getTime() > limit;
        });
  return {
    planned: mine.length,
    due: mine.length,
    actual: bad.length,
    pct: mine.length ? pct(bad.length, mine.length) : null,
  };
}

/** Next week's target: the benchmark once it's met, otherwise close the gap by 10 points a week. */
export function nextTarget(actualPct: number | null, benchmark: number): number {
  if (actualPct === null || actualPct <= benchmark) return benchmark;
  return Math.max(benchmark, actualPct - 10);
}

export function kpiState(thisWeek: number | null, lastWeek: number | null, benchmark: number): KpiState {
  if (thisWeek === null) return 'noData';
  if (thisWeek <= benchmark) return 'meets';
  return lastWeek !== null && lastWeek > benchmark ? 'missedTwice' : 'off';
}

export function scorecard(
  personId: string,
  tasks: ScoredTask[],
  week: { from: Date; to: Date },
  now: Date,
  opts: { verifySlaMinutes: number; benchmarks?: Partial<Record<KpiKey, number>> },
): ScoreLine[] {
  const prev = { from: new Date(week.from.getTime() - 7 * DAY), to: week.from };
  const slaMs = opts.verifySlaMinutes * 60_000;
  return KPI_KEYS.map((kpi) => {
    const benchmark = opts.benchmarks?.[kpi] ?? 0;
    const cur = measure(kpi, personId, tasks, week.from, week.to, now, slaMs);
    const last = measure(kpi, personId, tasks, prev.from, prev.to, now, slaMs);
    return {
      kpi,
      benchmark,
      lastWeekPct: last.pct,
      planned: cur.planned,
      actual: cur.actual,
      actualPct: cur.pct,
      nextTarget: nextTarget(cur.pct, benchmark),
      state: kpiState(cur.pct, last.pct, benchmark),
    };
  });
}

/** "Done this week (on time)" and "My score" tiles. */
export function weekTiles(personId: string, tasks: ScoredTask[], week: { from: Date; to: Date }, now: Date) {
  const lines = scorecard(personId, tasks, week, now, { verifySlaMinutes: 60 });
  const notDone = lines.find((l) => l.kpi === 'notDone')!;
  const done = tasks.filter(
    (t) => t.doerId === personId && t.doneAt && t.doneAt >= week.from && t.doneAt < week.to,
  );
  return {
    doneThisWeek: done.length,
    doneOnTime: done.filter((t) => t.doneAt! <= t.plannedAt).length,
    score: notDone.actualPct === null ? null : 100 - notDone.actualPct,
  };
}
