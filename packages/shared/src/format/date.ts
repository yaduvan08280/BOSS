/** All instants are stored in UTC and shown in the company time zone (default Asia/Kolkata). */
export const DEFAULT_TZ = 'Asia/Kolkata';

function parts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: map.day ?? '',
    monthStr: map.month ?? '',
    hour: map.hour ?? '',
    minute: map.minute ?? '',
  };
}

/** DD/MM/YYYY */
export function formatDate(date: Date | string, tz = DEFAULT_TZ): string {
  const p = parts(new Date(date), tz);
  return `${p.day}/${p.monthStr}/${p.year}`;
}

/** DD/MM/YYYY HH:mm */
export function formatDateTime(date: Date | string, tz = DEFAULT_TZ): string {
  const p = parts(new Date(date), tz);
  return `${p.day}/${p.monthStr}/${p.year} ${p.hour}:${p.minute}`;
}

/** DD/MM/YYYY HH:mm everywhere — lists, chips, Telegram (decision: never a date without its year). */
export function formatShortDateTime(date: Date | string, tz = DEFAULT_TZ): string {
  return formatDateTime(date, tz);
}

/** A local calendar date "YYYY-MM-DD" as DD/MM/YYYY. */
export function formatLocalDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Financial year that contains `date`, e.g. { start: 2026, end: 2027, short: '26-27', label: 'FY 2026-27' }. */
export function financialYear(date: Date | string, tz = DEFAULT_TZ, startMonth = 4) {
  const p = parts(new Date(date), tz);
  const start = p.month >= startMonth ? p.year : p.year - 1;
  const end = start + 1;
  const short = `${String(start).slice(-2)}-${String(end).slice(-2)}`;
  return { start, end, short, label: `FY ${start}-${String(end).slice(-2)}` };
}

/** Wall-clock setting (minutes from midnight) ↔ "HH:mm". */
export function minutesToHHmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) throw new Error(`Invalid time ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}
