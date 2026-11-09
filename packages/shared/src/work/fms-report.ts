/**
 * Delegation sheet → FMS report: a week of process (FMS) steps per person.
 *
 * Every step is graded exactly once: in the week it was done, or (while still open) in the week it was due,
 * as soon as its planned time has passed. On time = done by its planned time. Skipped steps never count.
 */
export type FmsStepFact = {
  status: string;
  plannedAt: Date;
  doneAt: Date | null;
};

export type FmsWeekRow = {
  /** Planned inside the week. */
  due: number;
  /** Done inside the week (early work counts at once). */
  done: number;
  /** Graded steps done by their planned time. */
  onTime: number;
  /** Graded steps done after their planned time, or still open past it. */
  late: number;
  /** Planned inside the week, still open and not yet due. */
  open: number;
  onTimePct: number | null;
};

const within = (d: Date, w: { from: Date; to: Date }) => d >= w.from && d < w.to;

export function fmsWeekRow(steps: FmsStepFact[], week: { from: Date; to: Date }, now: Date): FmsWeekRow {
  const row = { due: 0, done: 0, onTime: 0, late: 0, open: 0 };
  for (const s of steps) {
    if (s.status === 'SKIPPED') continue;
    if (within(s.plannedAt, week)) row.due++;
    if (s.doneAt) {
      if (!within(s.doneAt, week)) continue;
      row.done++;
      if (s.doneAt <= s.plannedAt) row.onTime++;
      else row.late++;
    } else if (within(s.plannedAt, week)) {
      if (s.plannedAt <= now) row.late++;
      else row.open++;
    }
  }
  const graded = row.onTime + row.late;
  return { ...row, onTimePct: graded ? Math.round((row.onTime / graded) * 100) : null };
}
