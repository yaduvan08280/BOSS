/**
 * Right-angle routing for a chart laid out in rows. Every line leaves the bottom of its box at a
 * place of its own, runs along a track of its own between two rows, and arrives at the top of the
 * next box at a place of its own — so lines are only ever horizontal or vertical, run side by side
 * and never share a path. A line that skips rows or goes back up travels in a lane of its own
 * beside the chart.
 */
export type Pt = { x: number; y: number };
export type Box = { id: string; x: number; y: number; w: number; h: number };
export type Link = { id: string; source: string; target: string };
export type Routed = {
  boxes: Map<string, Box>;
  routes: Map<string, { points: Pt[]; back: boolean }>;
  width: number;
  height: number;
};

const TRACK = 12; // between two lines in the same gap
const PAD = 24; // from a row to the first track
const LANE = 14; // between two lanes beside the chart
const MARGIN = 20;

type Seg = { link: string; from: number; to: number; part: 'a' | 'b' };

export function routeOrthogonal(input: Box[], links: Link[]): Routed {
  // Rows: boxes whose middles share a height.
  const mids = [...new Set(input.map((b) => Math.round(b.y + b.h / 2)))].sort((a, b) => a - b);
  const rankOf = new Map(input.map((b) => [b.id, mids.indexOf(Math.round(b.y + b.h / 2))]));
  const box = new Map(input.map((b) => [b.id, { ...b }]));
  const cx = (id: string) => box.get(id)!.x + box.get(id)!.w / 2;
  const live = links.filter((l) => box.has(l.source) && box.has(l.target));

  const minX = Math.min(...input.map((b) => b.x));
  const maxX = Math.max(...input.map((b) => b.x + b.w));
  const mid = (minX + maxX) / 2;

  // Lines to the very next row go straight across the gap; the others take a lane at the nearer side.
  const direct = (l: Link) => rankOf.get(l.target)! === rankOf.get(l.source)! + 1;
  // A line that skips rows goes straight down when nothing stands under its source on the way.
  const through = (l: Link) => {
    const s = box.get(l.source)!;
    const [from, to] = [rankOf.get(l.source)!, rankOf.get(l.target)!];
    return (
      to > from + 1 &&
      input.every((b) => {
        const r = rankOf.get(b.id)!;
        return r <= from || r >= to || b.x > s.x + s.w + 8 || b.x + b.w < s.x - 8;
      })
    );
  };
  const span = (l: Link) => Math.abs(rankOf.get(l.target)! - rankOf.get(l.source)!);
  const laneX = new Map<string, number>();
  for (const side of ['left', 'right'] as const) {
    live
      .filter((l) => !direct(l) && !through(l) && ((cx(l.source) + cx(l.target)) / 2 < mid ? 'left' : 'right') === side)
      .sort((a, b) => span(a) - span(b) || a.id.localeCompare(b.id))
      .forEach((l, i) =>
        laneX.set(l.id, side === 'left' ? minX - PAD - i * LANE : maxX + PAD + i * LANE),
      );
  }

  // A place of its own for each line on the bottom of its source and the top of its target.
  const outX = new Map<string, number>();
  const inX = new Map<string, number>();
  const spread = (ids: Link[], b: Box, key: (l: Link) => number, into: Map<string, number>) =>
    [...ids]
      .sort((p, q) => key(p) - key(q) || p.id.localeCompare(q.id))
      .forEach((l, i, all) => into.set(l.id, Math.round(b.x + (b.w * (i + 1)) / (all.length + 1))));
  for (const b of input)
    spread(
      live.filter((l) => l.source === b.id),
      b,
      (l) => laneX.get(l.id) ?? cx(l.target),
      outX,
    );
  for (const b of input)
    spread(
      live.filter((l) => l.target === b.id),
      b,
      (l) => laneX.get(l.id) ?? outX.get(l.id)!,
      inX,
    );

  // Straight where it can be: a line from the row above that leaves over its target arrives right
  // under where it left. The target's other arrivals keep their order in the room that is left, and
  // none stands exactly under another line's departure (their vertical pieces would overlap).
  const GAP = 10;
  for (const b of input) {
    const arriving = live.filter((l) => l.target === b.id);
    const taken: number[] = [];
    const free = (x: number) => taken.every((o) => Math.abs(o - x) >= GAP);
    const straight = new Set<string>();
    for (const l of arriving) {
      const x = outX.get(l.id)!;
      if (laneX.get(l.id) === undefined && x >= b.x + GAP && x <= b.x + b.w - GAP && free(x)) {
        inX.set(l.id, x);
        taken.push(x);
        straight.add(l.id);
      }
    }
    const above = rankOf.get(b.id)! - 1;
    const leaving = live.filter((o) => rankOf.get(o.source) === above).map((o) => outX.get(o.id)!);
    for (const l of arriving.filter((o) => !straight.has(o.id))) {
      let x = inX.get(l.id)!;
      const clear = (v: number) => free(v) && !leaving.includes(v);
      for (let n = 1; !clear(x) && n < 40; n++) {
        const v = inX.get(l.id)! + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 5;
        if (v > b.x + 4 && v < b.x + b.w - 4) x = v;
      }
      inX.set(l.id, x);
      taken.push(x);
    }
  }

  // Horizontal pieces, by the gap they lie in (gap g is under row g; gap -1 is above the first row).
  const gaps = new Map<number, Seg[]>();
  const add = (gap: number, seg: Seg) => {
    if (seg.from !== seg.to) gaps.set(gap, [...(gaps.get(gap) ?? []), seg]);
  };
  for (const l of live) {
    const lane = laneX.get(l.id);
    if (lane === undefined) {
      const gap = direct(l) ? rankOf.get(l.source)! : rankOf.get(l.target)! - 1;
      add(gap, { link: l.id, from: outX.get(l.id)!, to: inX.get(l.id)!, part: 'a' });
    } else {
      add(rankOf.get(l.source)!, { link: l.id, from: outX.get(l.id)!, to: lane, part: 'a' });
      add(rankOf.get(l.target)! - 1, { link: l.id, from: lane, to: inX.get(l.id)!, part: 'b' });
    }
  }
  // Track order that keeps crossings low: lines going left, leftmost start on top; then lines going
  // right, rightmost start on top.
  const trackOf = new Map<string, number>();
  for (const [, segs] of gaps) {
    const left = segs.filter((s) => s.to < s.from).sort((a, b) => a.from - b.from || a.to - b.to);
    const right = segs.filter((s) => s.to > s.from).sort((a, b) => b.from - a.from || b.to - a.to);
    [...left, ...right].forEach((s, i) => trackOf.set(`${s.link}:${s.part}`, i));
  }
  const gapHeight = (g: number) => {
    const n = gaps.get(g)?.length ?? 0;
    if (g === -1 || g === mids.length - 1) return n ? PAD * 2 + (n - 1) * TRACK : MARGIN;
    return PAD * 2 + Math.max(0, n - 1) * TRACK;
  };

  // Rows are placed again from the top, each gap as tall as its tracks need.
  const rowH = mids.map((_, r) => Math.max(...input.filter((b) => rankOf.get(b.id) === r).map((b) => b.h)));
  const rowTop: number[] = [];
  const gapTop = new Map<number, number>([[-1, 0]]);
  let y = gapHeight(-1);
  mids.forEach((_, r) => {
    rowTop.push(y);
    gapTop.set(r, y + rowH[r]!);
    y += rowH[r]! + gapHeight(r);
  });
  const shift = MARGIN - Math.min(minX, ...laneX.values());
  for (const b of box.values()) {
    const r = rankOf.get(b.id)!;
    b.y = rowTop[r]! + (rowH[r]! - b.h) / 2;
    b.x += shift;
  }
  const trackY = (gap: number, key: string) =>
    gapTop.get(gap)! + PAD + (trackOf.get(key) ?? 0) * TRACK;

  const routes = new Map<string, { points: Pt[]; back: boolean }>();
  for (const l of live) {
    const s = box.get(l.source)!;
    const t = box.get(l.target)!;
    const sx = outX.get(l.id)! + shift;
    const tx = inX.get(l.id)! + shift;
    const from = { x: sx, y: s.y + s.h };
    const to = { x: tx, y: t.y };
    const lane = laneX.get(l.id);
    let points: Pt[];
    if (lane === undefined) {
      const ty = trackY(direct(l) ? rankOf.get(l.source)! : rankOf.get(l.target)! - 1, `${l.id}:a`);
      points = sx === tx ? [from, to] : [from, { x: sx, y: ty }, { x: tx, y: ty }, to];
    } else {
      const lx = lane + shift;
      const ya = trackY(rankOf.get(l.source)!, `${l.id}:a`);
      const yb = trackY(rankOf.get(l.target)! - 1, `${l.id}:b`);
      points = [from, { x: sx, y: ya }, { x: lx, y: ya }, { x: lx, y: yb }, { x: tx, y: yb }, to];
    }
    routes.set(l.id, { points, back: rankOf.get(l.target)! <= rankOf.get(l.source)! });
  }
  return {
    boxes: box,
    routes,
    width: Math.max(maxX, ...laneX.values()) + shift + MARGIN,
    height: y,
  };
}
