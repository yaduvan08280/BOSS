/** Quiet hours: no messages between start and end (company time zone), except escalations. */
export type QuietHours = { start: string; end: string };
export const DEFAULT_QUIET_HOURS: QuietHours = { start: '21:00', end: '07:00' };

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Minutes since local midnight in `tz`, plus the offset used to get back to UTC. */
function localMinutes(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function isQuiet(at: Date, tz: string, quiet: QuietHours = DEFAULT_QUIET_HOURS): boolean {
  const now = localMinutes(at, tz);
  const s = toMin(quiet.start);
  const e = toMin(quiet.end);
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

/** The first moment at or after `at` that is outside quiet hours. */
export function nextSendTime(at: Date, tz: string, quiet: QuietHours = DEFAULT_QUIET_HOURS): Date {
  if (!isQuiet(at, tz, quiet)) return at;
  const now = localMinutes(at, tz);
  const end = toMin(quiet.end);
  const wait = (end - now + 1440) % 1440;
  const next = new Date(at.getTime() + wait * 60_000);
  next.setUTCSeconds(0, 0);
  return next;
}
