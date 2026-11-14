import { describe, expect, it } from 'vitest';
import { PROCESSES, processesInto, processGraph, systemMap } from './processes';

describe('process catalog (decision 238)', () => {
  it('has unique keys and links that lead to known processes', () => {
    const keys = PROCESSES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PROCESSES)
      for (const l of p.links ?? []) expect(keys, `${p.key} → ${l.to}`).toContain(l.to);
  });

  it('draws every process: one start, every status reachable, every link attached', () => {
    for (const p of PROCESSES) {
      const g = processGraph(p.key)!;
      expect(
        g.nodes.filter((n) => n.kind === 'start'),
        p.key,
      ).toHaveLength(1);
      // In the usual situation (and the extra ones) nothing is greyed out.
      if (!('engine' in p))
        expect(
          g.nodes.filter((n) => n.off).map((n) => n.key),
          p.key,
        ).toEqual([]);
      const links = g.nodes.filter((n) => n.kind === 'link');
      expect(
        links.map((n) => n.target),
        `${p.key}: a link's "from" matched nothing`,
      ).toEqual((p.links ?? []).map((l) => l.to));
      for (const e of g.edges) {
        expect(g.nodes.some((n) => n.id === e.source)).toBe(true);
        expect(g.nodes.some((n) => n.id === e.target)).toBe(true);
      }
    }
  });

  it('draws every outcome of a step that can end in several places', () => {
    const order = processGraph('pos_order')!;
    const settle = order.nodes.find((n) => n.key === 'settle')!;
    expect(
      order.edges
        .filter((e) => e.source === settle.id)
        .map((e) => e.target)
        .sort(),
    ).toEqual(['BILLED', 'PAID']);
    const transfer = processGraph('stock_transfer')!;
    const receive = transfer.nodes.find((n) => n.key === 'receive')!;
    expect(
      transfer.edges
        .filter((e) => e.source === receive.id)
        .map((e) => e.target)
        .sort(),
    ).toEqual(['CLOSED', 'RECEIVED']);
  });

  it('knows what leads into a process, and maps the whole system', () => {
    expect(
      processesInto('pos_order')
        .map((x) => x.from)
        .sort(),
    ).toEqual(['reservation', 'waitlist']);
    const all = systemMap(true);
    expect(all.nodes).toHaveLength(PROCESSES.length);
    expect(all.edges.some((e) => e.source === 'reservation' && e.target === 'pos_order')).toBe(true);
    const plain = systemMap(false);
    expect(plain.nodes.some((n) => n.id === 'stay')).toBe(false);
    expect(plain.edges.every((e) => plain.nodes.some((n) => n.id === e.target))).toBe(true);
  });
});
