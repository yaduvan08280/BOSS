import { describe, expect, it } from 'vitest';
import { routeOrthogonal, type Box, type Link } from './route';

const box = (id: string, x: number, row: number): Box => ({ id, x, y: row * 100, w: 160, h: 40 });

describe('right-angle routing', () => {
  const boxes = [box('a', 200, 0), box('b', 0, 1), box('c', 200, 1), box('d', 400, 1), box('e', 200, 2)];
  const links: Link[] = [
    { id: '1', source: 'a', target: 'b' },
    { id: '2', source: 'a', target: 'c' },
    { id: '3', source: 'a', target: 'd' },
    { id: '4', source: 'b', target: 'e' },
    { id: '5', source: 'c', target: 'e' },
    { id: '6', source: 'd', target: 'e' },
    { id: '7', source: 'e', target: 'a' }, // goes back
    { id: '8', source: 'a', target: 'e' }, // skips a row
  ];
  const out = routeOrthogonal(boxes, links);
  type S = { link: string; x1: number; y1: number; x2: number; y2: number };
  const segs: S[] = [];
  for (const [link, r] of out.routes)
    r.points.slice(1).forEach((p, i) => {
      const q = r.points[i]!;
      segs.push({ link, x1: Math.min(p.x, q.x), y1: Math.min(p.y, q.y), x2: Math.max(p.x, q.x), y2: Math.max(p.y, q.y) });
    });

  it('draws only horizontal and vertical pieces', () => {
    expect(out.routes.size).toBe(links.length);
    for (const s of segs) expect(s.x1 === s.x2 || s.y1 === s.y2).toBe(true);
  });

  it('never lays two lines on top of each other', () => {
    for (const a of segs)
      for (const b of segs) {
        if (a.link >= b.link) continue;
        const sameRow = a.y1 === a.y2 && b.y1 === b.y2 && a.y1 === b.y1 && a.x1 < b.x2 && b.x1 < a.x2;
        const sameCol = a.x1 === a.x2 && b.x1 === b.x2 && a.x1 === b.x1 && a.y1 < b.y2 && b.y1 < a.y2;
        expect(sameRow || sameCol, `${a.link} over ${b.link}`).toBe(false);
      }
  });

  it('never runs a line through a box', () => {
    for (const s of segs)
      for (const b of out.boxes.values()) {
        const inside = s.x1 < b.x + b.w && s.x2 > b.x && s.y1 < b.y + b.h && s.y2 > b.y;
        expect(inside, `${s.link} through ${b.id}`).toBe(false);
      }
  });

  it('marks the line that goes back and ends every line on top of its target', () => {
    expect(out.routes.get('7')!.back).toBe(true);
    expect(out.routes.get('8')!.back).toBe(false);
    for (const l of links) {
      const pts = out.routes.get(l.id)!.points;
      const end = pts[pts.length - 1]!;
      const t = out.boxes.get(l.target)!;
      expect(end.y).toBe(t.y);
      expect(end.x).toBeGreaterThan(t.x);
      expect(end.x).toBeLessThan(t.x + t.w);
    }
  });
});
