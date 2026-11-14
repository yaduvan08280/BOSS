import type { Machine } from '../machines/transition';

/** Legend of the flow designer (CLAUDE.md §5). */
/** `link` = this leads into another process (its `target`); the chart opens that one when it is tapped. */
export type FlowNodeKind = 'start' | 'action' | 'auto' | 'status' | 'finished' | 'deadend' | 'link';
export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  /** Status or action key; the page translates it. */
  key: string;
  roles: string[];
  /** Switched off by the company's settings, or unreachable because of them. */
  off: boolean;
  /** For a `link` node: the process it leads to. */
  target?: string;
};
export type FlowEdge = { id: string; source: string; target: string; off: boolean };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

export type GraphOptions<S extends string> = {
  start: { key: string; to: S };
  /** Actions that never change the status (follow-up, comment…): listed, not drawn. */
  keep?: readonly string[];
  finished?: readonly S[];
  deadEnds?: readonly S[];
  /** Automatic steps that live outside the machine (escalations). */
  extra?: { key: string; from: readonly S[]; to: string; kind: 'finished' | 'deadend' }[];
  /** More situations to draw: a rule is on when its guard holds in any of them, and goes to every status it can. */
  also?: readonly unknown[];
  /** Where the process hands over to another: from a status or an action (its key), to a process. */
  links?: readonly ProcessLink[];
};

/** "…leads to another process": `from` is a status or an action key of this machine, `key` names the hand-over. */
export type ProcessLink = { from: string; to: string; key: string };

/**
 * Status → action → status chart of a machine under the given settings.
 * Each rule becomes one action node; a rule whose guard is false is drawn as "off",
 * and any status nothing can reach any more (e.g. "To verify" with verification off) too.
 */
export function machineGraph<S extends string, A extends string, R extends string, C>(
  machine: Machine<S, A, R, C>,
  ctx: C,
  opts: GraphOptions<S>,
): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const statusKind = (s: string): FlowNodeKind =>
    opts.finished?.includes(s as S) ? 'finished' : opts.deadEnds?.includes(s as S) ? 'deadend' : 'status';
  const status = (s: string) => {
    if (!nodes.has(s)) nodes.set(s, { id: s, kind: statusKind(s), key: s, roles: [], off: false });
    return s;
  };
  const edge = (source: string, target: string, off = false) =>
    edges.push({ id: `${source}->${target}`, source, target, off });

  nodes.set('start', { id: 'start', kind: 'start', key: opts.start.key, roles: [], off: false });
  edge('start', status(opts.start.to));

  machine.rules.forEach((rule, i) => {
    if (opts.keep?.includes(rule.action)) return;
    const from = rule.from === '*' ? machine.states : typeof rule.from === 'string' ? [rule.from] : rule.from;
    const sources = from.filter((s) => !machine.terminal?.includes(s));
    if (!sources.length) return;
    const ctxs = [ctx, ...((opts.also ?? []) as C[])];
    const live = ctxs.filter((c) => !rule.guard || rule.guard(c));
    const off = live.length === 0;
    const targets = [
      ...new Set((off ? [ctx] : live).map((c) => (typeof rule.to === 'function' ? rule.to(c) : rule.to))),
    ];
    const id = `a${i}`;
    const auto = rule.roles.every((r) => r === 'system');
    nodes.set(id, { id, kind: auto ? 'auto' : 'action', key: rule.action, roles: [...rule.roles], off });
    for (const s of sources) edge(status(s), id, off);
    for (const to of targets) edge(id, status(to), off);
  });

  opts.extra?.forEach((x, i) => {
    const id = `x${i}`;
    nodes.set(id, { id, kind: 'auto', key: x.key, roles: ['system'], off: false });
    nodes.set(x.to, { id: x.to, kind: x.kind, key: x.to, roles: [], off: false });
    for (const s of x.from) edge(status(s), id);
    edge(id, x.to);
  });

  opts.links?.forEach((l, i) => {
    // A status by that name, else every action node with that key.
    const from = nodes.has(l.from)
      ? [l.from]
      : [...nodes.values()]
          .filter((n) => (n.kind === 'action' || n.kind === 'auto') && n.key === l.from)
          .map((n) => n.id);
    if (!from.length) return;
    const id = `l${i}`;
    nodes.set(id, { id, kind: 'link', key: l.key, roles: [], off: false, target: l.to });
    for (const f of from) edge(f, id);
  });

  // Whatever can't be reached from the start along switched-on steps is off too.
  const reach = new Set(['start']);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges)
      if (!e.off && reach.has(e.source) && !reach.has(e.target)) {
        reach.add(e.target);
        grew = true;
      }
  }
  for (const n of nodes.values()) if (!reach.has(n.id)) n.off = true;
  for (const e of edges) if (!reach.has(e.source) || !reach.has(e.target)) e.off = true;
  return { nodes: [...nodes.values()], edges };
}
