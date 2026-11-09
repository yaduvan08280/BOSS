import { fmsWeekRow, type FmsStepFact } from './fms-report';

/** Weekly MIS (CLAUDE.md §5.6): one row per person, across modules. Percentages are of what was due. */
export type MisTask = {
  doerId: string;
  verifierId: string | null;
  status: string;
  plannedAt: Date;
  doneAt: Date | null;
  verifiedAt: Date | null;
};
export type MisRun = { doerId: string; plannedAt: Date; status: string };
export type MisTicket = { solverId: string; status: string; plannedFixAt: Date; resolvedAt: Date | null };
/** An FMS step the person holds (graded like Delegation → FMS report, decision 101). */
export type MisStep = FmsStepFact & { doerId: string };

export type MisPart = { total: number; good: number; pct: number | null };
export type MisRow = {
  personId: string;
  tasks: { planned: number; done: MisPart; onTime: MisPart };
  verifications: MisPart;
  checklists: MisPart;
  tickets: MisPart;
  /** FMS steps on time: graded once, in the week done or (still open) the week due. */
  fms: MisPart;
  score: number | null;
};

const part = (total: number, good: number): MisPart => ({
  total,
  good,
  pct: total ? Math.round((good / total) * 100) : null,
});

export function misRow(
  personId: string,
  data: { tasks: MisTask[]; runs: MisRun[]; tickets: MisTicket[]; steps?: MisStep[] },
  week: { from: Date; to: Date },
  now: Date,
  verifySlaMinutes: number,
): MisRow {
  const cutoff = new Date(Math.min(week.to.getTime(), now.getTime()));
  const inWeek = (d: Date) => d >= week.from && d < week.to;
  const live = data.tasks.filter((t) => t.status !== 'CANCELLED');

  const mine = live.filter((t) => t.doerId === personId && inWeek(t.plannedAt));
  // Due by now, or already finished (early work counts at once — same rule as the scorecard).
  const due = mine.filter((t) => t.plannedAt <= cutoff || (t.doneAt && t.doneAt <= cutoff));
  const done = due.filter((t) => t.doneAt && t.doneAt <= cutoff);
  const onTime = done.filter((t) => t.doneAt! <= t.plannedAt);

  const handedIn = live.filter((t) => t.verifierId === personId && t.doneAt && inWeek(t.doneAt));
  const sla = verifySlaMinutes * 60_000;
  const verifiedInTime = handedIn.filter(
    (t) => t.verifiedAt && t.verifiedAt.getTime() - t.doneAt!.getTime() <= sla,
  );

  const runs = data.runs.filter((r) => r.doerId === personId && inWeek(r.plannedAt) && r.plannedAt <= cutoff);
  const runsDone = runs.filter((r) => r.status === 'DONE' || r.status === 'PENDING_VERIFY');

  const tickets = data.tickets.filter(
    (t) =>
      t.solverId === personId &&
      t.status !== 'CANCELLED' &&
      inWeek(t.plannedFixAt) &&
      t.plannedFixAt <= cutoff,
  );
  const fixedInTime = tickets.filter((t) => t.resolvedAt && t.resolvedAt <= t.plannedFixAt);

  const steps = fmsWeekRow(
    (data.steps ?? []).filter((s) => s.doerId === personId),
    week,
    now,
  );

  const row: MisRow = {
    personId,
    tasks: {
      planned: mine.length,
      done: part(due.length, done.length),
      onTime: part(due.length, onTime.length),
    },
    verifications: part(handedIn.length, verifiedInTime.length),
    checklists: part(runs.length, runsDone.length),
    tickets: part(tickets.length, fixedInTime.length),
    fms: part(steps.onTime + steps.late, steps.onTime),
    score: null,
  };
  const pcts = [row.tasks.done, row.tasks.onTime, row.verifications, row.checklists, row.tickets, row.fms]
    .map((p) => p.pct)
    .filter((p): p is number => p !== null);
  row.score = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  return row;
}
