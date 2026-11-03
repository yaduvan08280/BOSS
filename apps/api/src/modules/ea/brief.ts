import { addDays, daysBetween, formatLocalDate, minutesToHHmm, weekdayOf } from '@mono/shared';

type Item = {
  number: number;
  text: string;
  stage: string;
  kind: string | null;
  scheduledDate: string | null;
  slotStart: number | null;
  slotMinutes: number | null;
  stageChangedAt: Date;
};
type Delegated = Item & { taskStatus: string | null };

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KIND: Record<string, string> = { meeting: '👥', call: '📞', review: '🔎', task: '•' };
const slot = (i: Item) =>
  `${minutesToHHmm(i.slotStart ?? 0)}–${minutesToHHmm((i.slotStart ?? 0) + (i.slotMinutes ?? 0))}`;
const line = (i: Item) => `${KIND[i.kind ?? 'task'] ?? '•'} ${slot(i)} ${i.text}`;

/** The 08:30 message to the owner (CLAUDE.md §5.5). Plain text: it goes to Telegram, email and in-app alike. */
export function buildBrief(
  today: string,
  items: Delegated[],
  s: { waitingCap: number; somedayReviewDays: number; delegationFollowUpDays: number },
  now: Date,
): string {
  const todays = items
    .filter((i) => i.stage === 'SCHEDULED' && i.scheduledDate === today)
    .sort((a, b) => (a.slotStart ?? 0) - (b.slotStart ?? 0));
  const count = (st: string) => items.filter((i) => i.stage === st).length;
  const chase = items.filter(
    (i) =>
      i.stage === 'DELEGATED' &&
      i.taskStatus !== 'DONE' &&
      now.getTime() - i.stageChangedAt.getTime() >= s.delegationFollowUpDays * 86_400_000,
  );
  const out = [todays.length ? `Today (${todays.length}):` : 'Nothing scheduled today.', ...todays.map(line)];
  const sort = count('CAPTURED');
  if (sort) out.push('', `To sort: ${sort} new capture${sort > 1 ? 's' : ''}.`);
  out.push(`Waiting: ${count('WAITING')} of ${s.waitingCap}.`);
  if (chase.length)
    out.push('', 'Delegated, still open — follow up:', ...chase.map((i) => `• #${i.number} ${i.text}`));
  // A Someday review every N days, counted from a fixed date so it needs no stored state.
  if (count('SOMEDAY') && daysBetween('2026-01-05', today) % s.somedayReviewDays === 0)
    out.push('', `Someday review today: ${count('SOMEDAY')} item${count('SOMEDAY') > 1 ? 's' : ''}.`);
  return out.join('\n');
}

/** The weekly-plan message: next week's schedule, day by day. */
export function buildWeekPlan(weekStart: string, items: Item[]): string {
  const out: string[] = [];
  for (let d = 0; d < 7; d++) {
    const date = addDays(weekStart, d);
    const day = items
      .filter((i) => i.stage === 'SCHEDULED' && i.scheduledDate === date)
      .sort((a, b) => (a.slotStart ?? 0) - (b.slotStart ?? 0));
    if (day.length) out.push(`${DAY_NAMES[weekdayOf(date)]} ${formatLocalDate(date)}:`, ...day.map(line));
  }
  return out.length ? out.join('\n') : 'Nothing scheduled next week yet.';
}
