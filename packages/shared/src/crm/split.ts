/**
 * Exact splitting (CLAUDE.md §11.1): a total in paise split by weights into parts that add up to the total
 * exactly, every time. Parts are whole `unit`s (₹1,000 / ₹10,000 / ₹1 L when the plan rounds figures);
 * whatever the unit can't hold goes to the biggest part. Largest-remainder method: no part is off its
 * fair share by more than one unit (plus that leftover).
 */
export function splitExact(total: number, weights: number[], unit = 1): number[] {
  if (!weights.length) return [];
  if (!Number.isSafeInteger(total) || total < 0) throw new Error(`splitExact: bad total ${total}`);
  const u = Math.max(1, Math.round(unit));
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const shares = sum > 0 ? w.map((x) => x / sum) : w.map(() => 1 / w.length);
  const units = Math.floor(total / u);
  const raw = shares.map((s) => units * s);
  const parts = raw.map((r) => Math.floor(r + 1e-9));
  let left = units - parts.reduce((a, b) => a + b, 0);
  // Hand out the units left over to the largest fractions (ties: the earlier part).
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r + 1e-9), share: shares[i]! }))
    .filter((x) => x.share > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) parts[order[k]!.i]!++;
  const out = parts.map((p) => p * u);
  const extra = total - units * u;
  if (extra) {
    let big = 0;
    shares.forEach((s, i) => (s > shares[big]! ? (big = i) : undefined));
    out[big]! += extra;
  }
  return out;
}

/** Round a figure to the plan's unit (nearest; 0 = no rounding). */
export const roundTo = (paise: number, unit: number) =>
  unit > 1 ? Math.round(paise / unit) * unit : Math.round(paise);

/**
 * Change one part and keep or change the total (the month dialog): `keep` spreads the difference over the
 * other parts in proportion to what they had; otherwise the total moves by the difference.
 */
export function setPart(
  parts: number[],
  index: number,
  value: number,
  keepTotal: boolean,
  unit = 1,
): number[] {
  const v = Math.max(0, Math.round(value));
  if (!keepTotal) return parts.map((p, i) => (i === index ? v : p));
  const total = parts.reduce((a, b) => a + b, 0);
  if (v > total) throw new Error('The month is more than the whole year');
  const others = splitExact(
    total - v,
    parts.map((p, i) => (i === index ? 0 : p || 1)),
    unit,
  );
  return others.map((p, i) => (i === index ? v : p));
}

/**
 * A table that adds up both ways: rows (people) with their totals, columns (months) with theirs, the two
 * totals equal. Each row is split over the columns still open, the last row takes what is left; a row that
 * would overfill a column hands the excess to a column with room. Every row and every column adds up exactly.
 */
export function splitGrid(rowTotals: number[], colTotals: number[]): number[][] {
  if (rowTotals.reduce((a, b) => a + b, 0) !== colTotals.reduce((a, b) => a + b, 0))
    throw new Error('splitGrid: rows and columns must have the same total');
  const left = [...colTotals];
  return rowTotals.map((total, r) => {
    if (r === rowTotals.length - 1) {
      const last = [...left];
      left.fill(0);
      return last;
    }
    const row = splitExact(total, left.some((x) => x > 0) ? left : colTotals);
    for (let c = 0; c < row.length; c++) {
      let over = row[c]! - left[c]!;
      for (let k = 0; over > 0 && k < row.length; k++) {
        const room = left[k]! - row[k]!;
        if (k === c || room <= 0) continue;
        const move = Math.min(room, over);
        row[k]! += move;
        row[c]! -= move;
        over -= move;
      }
    }
    row.forEach((x, c) => (left[c]! -= x));
    return row;
  });
}
