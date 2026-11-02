/** Date-only helpers in a company time zone. Dates are 'YYYY-MM-DD' strings; instants are Date (UTC). */

function tzParts(at: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second! };
}

/** Minutes the zone is ahead of UTC at that instant (IST = 330). */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const p = tzParts(at, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - at.getTime()) / 60_000);
}

export function localDate(at: Date, tz: string): string {
  const p = tzParts(at, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Local wall-clock (date + minutes from midnight) → the UTC instant. */
export function zonedToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = guess - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  // Second pass settles DST edges.
  return new Date(guess - tzOffsetMinutes(new Date(first), tz) * 60_000);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Monday–Sunday week containing the instant, as local dates and UTC instants. */
export function weekOf(at: Date, tz: string) {
  const today = localDate(at, tz);
  const start = addDays(today, 1 - weekdayOf(today));
  const end = addDays(start, 6);
  return { start, end, from: zonedToUtc(start, 0, tz), to: zonedToUtc(addDays(end, 1), 0, tz) };
}
