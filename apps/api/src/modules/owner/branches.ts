import type { Db } from '@mono/db';
import type { Actor } from '../work/actor';
import { needOwner, num, pct, places, spanOf, type Span } from './core';

export type BranchRow = {
  branchId: string;
  branch: string;
  type: string;
  manager: string | null;
  /** Paise, before nothing is taken off: what the bills came to. */
  sales: number;
  bills: number;
  voidPct: number | null;
  discountPct: number | null;
  wastagePct: number | null;
  cashDiff: number;
  attendancePct: number | null;
  lateWorkPct: number | null;
  checklistMissedPct: number | null;
  people: number;
};

/** The same handful of numbers for every branch over a span — the base of the league table and the exceptions. */
export async function branchNumbers(db: Db, companyId: string, s: Span): Promise<BranchRow[]> {
  const pl = await places(db, companyId);
  const days = { gte: s.from, lte: s.to };
  const [checks, voids, wastage, posDays, att, tasks, runs] = await Promise.all([
    db.posCheck.findMany({
      where: { companyId, businessDay: days, status: { not: 'CANCELLED' } },
      select: { outletId: true, total: true, discount: true },
    }),
    db.posOrderItem.findMany({
      where: { companyId, status: 'VOID', voidReason: { not: null }, order: { businessDay: days } },
      select: { price: true, qty: true, order: { select: { outletId: true } } },
    }),
    db.stockMove.findMany({
      where: { companyId, refType: 'wastage', status: 'APPLIED', at: { gte: s.start, lt: s.end } },
      select: { locationId: true, value: true, qty: true, rate: true },
    }),
    db.posDay.findMany({ where: { companyId, businessDay: days }, select: { outletId: true, report: true } }),
    db.attendanceDay.groupBy({
      by: ['branchId', 'status'],
      where: { companyId, date: days },
      _count: { _all: true },
    }),
    db.task.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        plannedAt: { gte: s.start, lt: s.end },
      },
      select: { branchId: true, plannedAt: true, doneAt: true, status: true },
    }),
    db.checklistRun.groupBy({
      by: ['branchId', 'status'],
      where: { companyId, plannedAt: { gte: s.start, lt: s.end }, master: { deletedAt: null } },
      _count: { _all: true },
    }),
  ]);
  const now = Date.now();
  return pl.branches
    .map((b) => {
      const mine = <T>(rows: T[], branchOf: (r: T) => string | null | undefined) =>
        rows.filter((r) => branchOf(r) === b.id);
      const myChecks = mine(checks, (c) => pl.branchOfOutlet.get(c.outletId));
      const sales = myChecks.reduce((n, c) => n + num(c.total), 0);
      const discount = myChecks.reduce(
        (n, c) => n + num((c.discount as { amount?: number } | null)?.amount),
        0,
      );
      const voided = mine(voids, (v) => pl.branchOfOutlet.get(v.order.outletId)).reduce(
        (n, v) => n + num(v.price) * num(v.qty),
        0,
      );
      const waste = mine(wastage, (w) => pl.branchOfLocation.get(w.locationId)).reduce(
        (n, w) => n + Math.abs(num(w.value) || num(w.qty) * num(w.rate)),
        0,
      );
      const cashDiff = mine(posDays, (d) => pl.branchOfOutlet.get(d.outletId)).reduce(
        (n, d) => n + num((d.report as { difference?: number } | null)?.difference),
        0,
      );
      const a = att.filter((x) => x.branchId === b.id);
      const count = (st: string[]) =>
        a.filter((x) => st.includes(x.status)).reduce((n, x) => n + x._count._all, 0);
      const worked = count(['PRESENT', 'LATE']) + count(['HALF_DAY']) / 2;
      const due = count(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT']);
      const myTasks = tasks.filter((t) => t.branchId === b.id);
      const late = myTasks.filter((t) =>
        t.doneAt ? t.doneAt > t.plannedAt : t.plannedAt.getTime() < now,
      ).length;
      const r = runs.filter((x) => x.branchId === b.id);
      const allRuns = r.reduce((n, x) => n + x._count._all, 0);
      const missed = r.filter((x) => x.status === 'MISSED').reduce((n, x) => n + x._count._all, 0);
      return {
        branchId: b.id,
        branch: b.name,
        type: b.type,
        manager: pl.managerOf(b.id),
        sales,
        bills: myChecks.length,
        voidPct: pct(voided, sales + voided),
        discountPct: pct(discount, sales + discount),
        wastagePct: sales ? pct(waste, sales) : null,
        cashDiff,
        attendancePct: pct(worked, due),
        lateWorkPct: pct(late, myTasks.length),
        checklistMissedPct: pct(missed, allRuns),
        people: pl.people.filter((p) => p.branchId === b.id && !p.deletedAt && p.status === 'ACTIVE').length,
      };
    })
    .sort((x, y) => y.sales - x.sales || x.branch.localeCompare(y.branch));
}

export const RANGE_KEYS = [
  'voidPct',
  'discountPct',
  'wastagePct',
  'cashDiff',
  'attendancePct',
  'lateWorkPct',
  'checklistMissedPct',
] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
/** The normal range of each number: a most (or, for attendance, a least). Cash is in rupees either way. */
export const DEFAULT_RANGES: Record<RangeKey, number> = {
  voidPct: 2,
  discountPct: 8,
  wastagePct: 3,
  cashDiff: 200,
  attendancePct: 90,
  lateWorkPct: 15,
  checklistMissedPct: 5,
};
type Stored = {
  all?: Partial<Record<RangeKey, number>>;
  branches?: Record<string, Partial<Record<RangeKey, number>>>;
};

export async function rangesOf(db: Db, companyId: string) {
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } });
  const stored = (((c.settings ?? {}) as { ownerRanges?: Stored }).ownerRanges ?? {}) as Stored;
  return {
    stored,
    of: (branchId: string): Record<RangeKey, number> => ({
      ...DEFAULT_RANGES,
      ...stored.all,
      ...stored.branches?.[branchId],
    }),
  };
}

export async function saveRanges(
  db: Db,
  actor: Actor,
  input: { branchId?: string | null; ranges: Partial<Record<RangeKey, number>> },
) {
  needOwner(actor);
  const c = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { settings: true },
  });
  const settings = (c.settings ?? {}) as { ownerRanges?: Stored };
  const now = settings.ownerRanges ?? {};
  const clean = Object.fromEntries(
    Object.entries(input.ranges).filter(
      ([k, v]) => (RANGE_KEYS as readonly string[]).includes(k) && Number.isFinite(v) && Number(v) >= 0,
    ),
  );
  const next: Stored = input.branchId
    ? { ...now, branches: { ...now.branches, [input.branchId]: clean } }
    : { ...now, all: clean };
  await db.company.update({
    where: { id: actor.companyId },
    data: { settings: { ...settings, ownerRanges: next } as object },
  });
  return { ok: true };
}

/**
 * Exceptions only: each branch says once what is normal; this lists what broke its range, worst first, with the
 * branch manager's name. A number with no data (no bills, no attendance) is never an exception.
 */
export async function exceptions(db: Db, actor: Actor, from?: string, to?: string) {
  needOwner(actor);
  const s = await spanOf(db, actor.companyId, from, to);
  const [rows, ranges] = await Promise.all([
    branchNumbers(db, actor.companyId, s),
    rangesOf(db, actor.companyId),
  ]);
  const out: {
    branchId: string;
    branch: string;
    manager: string | null;
    key: RangeKey;
    value: number;
    limit: number;
    over: number;
  }[] = [];
  for (const r of rows) {
    const limits = ranges.of(r.branchId);
    for (const key of RANGE_KEYS) {
      const raw = r[key];
      if (raw === null) continue;
      const value = key === 'cashDiff' ? Math.abs(raw) / 100 : raw;
      const limit = limits[key];
      const broke = key === 'attendancePct' ? value < limit : value > limit;
      if (!broke) continue;
      // How far outside, as a share of the limit — so different kinds of number can be ranked together.
      const over = limit > 0 ? Math.abs(value - limit) / limit : value;
      out.push({ branchId: r.branchId, branch: r.branch, manager: r.manager, key, value, limit, over });
    }
  }
  return {
    from: s.from,
    to: s.to,
    exceptions: out.sort((a, b) => b.over - a.over),
    branches: rows.map((r) => ({
      branchId: r.branchId,
      branch: r.branch,
      ranges: ranges.of(r.branchId),
      own: Boolean(ranges.stored.branches?.[r.branchId]),
    })),
    defaults: { ...DEFAULT_RANGES, ...ranges.stored.all },
  };
}

/** The league table: every branch on the same numbers, each ranked; the score is the average rank (1 = best). */
export async function league(db: Db, actor: Actor, from?: string, to?: string) {
  needOwner(actor);
  const s = await spanOf(db, actor.companyId, from, to);
  const rows = await branchNumbers(db, actor.companyId, s);
  const rankBy = (key: keyof BranchRow, highIsGood: boolean) => {
    const have = rows.filter((r) => r[key] !== null);
    const sorted = [...have].sort((a, b) =>
      highIsGood ? num(b[key]) - num(a[key]) : num(a[key]) - num(b[key]),
    );
    return new Map(sorted.map((r, i) => [r.branchId, i + 1]));
  };
  const ranks = {
    sales: rankBy('sales', true),
    attendancePct: rankBy('attendancePct', true),
    lateWorkPct: rankBy('lateWorkPct', false),
    checklistMissedPct: rankBy('checklistMissedPct', false),
    voidPct: rankBy('voidPct', false),
    discountPct: rankBy('discountPct', false),
    wastagePct: rankBy('wastagePct', false),
  };
  const table = rows
    .map((r) => {
      const mine = Object.values(ranks)
        .map((m) => m.get(r.branchId))
        .filter((x): x is number => x !== undefined);
      return {
        ...r,
        ranks: Object.fromEntries(Object.entries(ranks).map(([k, m]) => [k, m.get(r.branchId) ?? null])),
        score: mine.length ? Math.round((mine.reduce((a, b) => a + b, 0) / mine.length) * 10) / 10 : null,
      };
    })
    .sort((a, b) => (a.score ?? 99) - (b.score ?? 99));
  return { from: s.from, to: s.to, branches: table };
}
