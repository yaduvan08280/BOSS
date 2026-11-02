import {
  addDays,
  formatDateTime,
  formatShortDateTime,
  localDate,
  tzOffsetMinutes,
  zonedToUtc,
} from '@mono/shared';

/** <input type="datetime-local"> value ('YYYY-MM-DDTHH:mm', company time zone) ↔ ISO instant. */
export function localInputToIso(value: string, tz: string): string {
  const [date, time = '18:00'] = value.split('T');
  const [h, m] = time.split(':').map(Number);
  return zonedToUtc(date!, (h ?? 0) * 60 + (m ?? 0), tz).toISOString();
}

export function isoToLocalInput(iso: string | Date, tz: string): string {
  const at = new Date(iso);
  const local = new Date(at.getTime() + tzOffsetMinutes(at, tz) * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Tomorrow 18:00, a sensible default planned time. */
export function defaultPlanned(tz: string): string {
  return `${addDays(localDate(new Date(), tz), 1)}T18:00`;
}

/** "overdue 2d", "in 3h", "due now". */
export function relative(iso: string | Date): { text: string; late: boolean } {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const unit =
    abs >= 86_400_000
      ? `${Math.round(abs / 86_400_000)}d`
      : abs >= 3_600_000
        ? `${Math.round(abs / 3_600_000)}h`
        : `${Math.max(1, Math.round(abs / 60_000))}m`;
  return diff < 0 ? { text: unit, late: true } : { text: unit, late: false };
}

export { formatDateTime, formatShortDateTime };
