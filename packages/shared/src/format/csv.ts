/**
 * One cell of a CSV file, safe to open in a spreadsheet. Text that starts with = + - @ (or a tab / return)
 * would be run as a formula by Excel — a name typed by a guest or a vendor could then run a command on the
 * computer of whoever opens the export — so such text gets a leading apostrophe and stays text. Numbers are
 * left as numbers (a negative amount is a number, not a formula).
 */
export function csvCell(value: unknown, alwaysQuote = false): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (
    typeof value !== 'number' &&
    typeof value !== 'bigint' &&
    /^[=+\-@\t\r]/.test(s) &&
    !/^-?\d+(\.\d+)?$/.test(s)
  )
    s = `'${s}`;
  return alwaysQuote || /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells as CSV text (every cell quoted, CRLF between rows). */
export const csvText = (rows: unknown[][]): string =>
  rows.map((r) => r.map((c) => csvCell(c, true)).join(',')).join('\r\n');
