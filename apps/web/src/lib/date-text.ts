/**
 * Typed dates and times. MONO shows and accepts dates only as DD/MM/YYYY and times as 24-hour HH:mm,
 * whatever the browser's language (the browser's own pickers follow its locale, e.g. MM/DD in en-US).
 */

/** "2026-11-04" → "04/11/2026" */
export function isoToDmy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Adds the slashes while typing: "0411" → "04/11", "04112026" → "04/11/2026". */
export function maskDmy(text: string): string {
  const d = text.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

/** "04/11/2026", "4/11/26", "4-11-2026" → "2026-11-04"; null when it isn't a real date. */
export function dmyToIso(text: string, thisYear = new Date().getFullYear()): string | null {
  const m = /^\s*(\d{1,2})[/.\-\s](\d{1,2})(?:[/.\-\s](\d{2}|\d{4}))?\s*$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : thisYear;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Round-trip check: 31/02 must not roll over into March.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "18:00", "1800", "18", "6pm", "6:30 pm", "0630" → "HH:mm" (24-hour); null when not a time. */
export function parseTime(text: string): string | null {
  const t = text.trim().toLowerCase();
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h !== 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
