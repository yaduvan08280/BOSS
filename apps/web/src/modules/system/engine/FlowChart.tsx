import { Graph, layout } from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Cog, Play } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { EngineModule, FlowGraph, FlowNodeKind } from '@mono/shared';
import { cn } from '@/lib/utils';
import { nodeLabel } from './fields';
import { routeOrthogonal, type Pt } from './route';

type Data = { label: string; kind: FlowNodeKind; off: boolean; roles: string };
const SIZE: Record<FlowNodeKind, [number, number]> = {
  start: [130, 38],
  action: [164, 48],
  auto: [164, 48],
  status: [184, 42],
  finished: [184, 42],
  deadend: [184, 42],
};
const STYLE: Record<FlowNodeKind, string> = {
  start: 'rounded-pill bg-foreground text-background font-semibold',
  action: 'rounded-control border bg-card text-foreground',
  auto: 'rounded-control border border-dashed bg-muted text-foreground',
  status: 'rounded-pill bg-status-info-bg text-status-info-fg font-semibold',
  finished: 'rounded-pill bg-status-ok-bg text-status-ok-fg font-semibold',
  deadend: 'rounded-pill bg-status-bad-bg text-status-bad-fg font-semibold',
};

function FlowNode({ data }: NodeProps<Node<Data>>) {
  const { t } = useTranslation();
  const [w, h] = SIZE[data.kind];
  return (
    <div
      style={{ width: w, height: h + (data.kind === 'action' ? 10 : 0) }}
      className={cn(
        'flex flex-col items-center justify-center px-2.5 py-1 text-center text-[13px] leading-tight shadow-sm',
        STYLE[data.kind],
        data.off && 'opacity-35 grayscale',
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-px !border-0 !opacity-0" />
      <span className="flex items-center gap-1">
        {data.kind === 'auto' && <Cog className="size-3" />}
        {data.kind === 'start' && <Play className="size-3" />}
        {data.label}
      </span>
      {data.roles && <span className="mt-0.5 text-[11px] font-normal opacity-70">{data.roles}</span>}
      {data.off && (
        <span className="mt-0.5 rounded-pill bg-background px-1.5 text-[9px] font-semibold uppercase text-muted-foreground">
          {t('engine.off')}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} className="!size-px !border-0 !opacity-0" />
    </div>
  );
}
const nodeTypes = { flow: FlowNode };

type Route = { points: Pt[]; off: boolean; back: boolean };

/** A line through the points: straight pieces with slightly softened right-angle corners. */
function cornerPath(pts: Pt[], radius = 5): string {
  const [first, ...rest] = pts;
  if (!first) return '';
  let d = `M${first.x},${first.y}`;
  rest.forEach((cur, i) => {
    const prev = pts[i]!;
    const next = pts[i + 2];
    if (!next) return void (d += ` L${cur.x},${cur.y}`);
    const before = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const after = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const r = Math.min(radius, before / 2, after / 2);
    const a = { x: cur.x + ((prev.x - cur.x) * r) / before, y: cur.y + ((prev.y - cur.y) * r) / before };
    const b = { x: cur.x + ((next.x - cur.x) * r) / after, y: cur.y + ((next.y - cur.y) * r) / after };
    d += ` L${a.x},${a.y} Q${cur.x},${cur.y} ${b.x},${b.y}`;
  });
  return d;
}

/**
 * One connection: its own route (right angles only, on a track of its own), an arrowhead where it
 * arrives, and a dot that travels along it. A line that goes back up is amber and dashed.
 */
function RouteEdge({ data }: EdgeProps<Edge<Route>>) {
  const pts = data?.points ?? [];
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  if (!data || !end || !prev) return null;
  const d = cornerPath(pts);
  const angle = (Math.atan2(end.y - prev.y, end.x - prev.x) * 180) / Math.PI;
  const colour = data.back ? 'var(--status-warn)' : 'var(--muted-foreground)';
  return (
    <g opacity={data.off ? 0.3 : 1}>
      <path d={d} fill="none" stroke="var(--card)" strokeWidth={6} strokeLinecap="round" />
      <path
        d={d}
        fill="none"
        stroke={colour}
        strokeWidth={1.75}
        strokeDasharray={data.off ? '4 4' : data.back ? '7 4' : undefined}
      />
      <path d="M0,0 L-10,-5 L-10,5 Z" fill={colour} transform={`translate(${end.x},${end.y}) rotate(${angle})`} />
      {!data.off && (
        <circle r={3} fill={colour} className="motion-reduce:hidden">
          <animateMotion dur={`${Math.max(2, pts.length * 0.8)}s`} repeatCount="indefinite" path={d} />
        </circle>
      )}
    </g>
  );
}
const edgeTypes = { route: RouteEdge };

/** The state machine as a top-to-bottom chart, laid out by dagre; switched-off steps fade out. */
export function FlowChart({
  module,
  graph,
  className,
}: {
  module: EngineModule;
  graph: FlowGraph;
  className?: string;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const { nodes, edges, width } = useMemo(() => {
    const g = new Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 56, edgesep: 20, ranksep: 60, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of graph.nodes)
      g.setNode(n.id, { width: SIZE[n.kind][0], height: SIZE[n.kind][1] + (n.kind === 'action' ? 10 : 0) });
    for (const e of graph.edges) g.setEdge(e.source, e.target);
    layout(g);
    const roleText = (roles: string[]) =>
      roles
        .filter((r) => r !== 'admin' && r !== 'system' && r !== 'any')
        .map((r) => t(`engine.role.${r}`))
        .join(' · ');
    const placed = routeOrthogonal(
      graph.nodes.map((n) => {
        const p = g.node(n.id);
        const [w, h] = SIZE[n.kind];
        return { id: n.id, x: p.x - w / 2, y: p.y - h / 2, w, h: h + (n.kind === 'action' ? 10 : 0) };
      }),
      graph.edges,
    );
    const nodes: Node<Data>[] = graph.nodes.map((n) => {
      const b = placed.boxes.get(n.id)!;
      return {
        id: n.id,
        type: 'flow',
        position: { x: b.x, y: b.y },
        data: {
          label: nodeLabel(t, module, n.kind, n.key),
          kind: n.kind,
          off: n.off,
          roles: n.kind === 'action' ? roleText(n.roles) : '',
        },
      };
    });
    const edges: Edge<Route>[] = graph.edges.map((e) => {
      const r = placed.routes.get(e.id);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'route',
        // Lines that go back are drawn last, so they stay visible where they cross.
        zIndex: r?.back ? 1 : 0,
        data: { points: r?.points ?? [], off: e.off, back: r?.back ?? false },
      };
    });
    return { nodes, edges, width: placed.width };
  }, [graph, module, t]);
  // Readable first: fit the width (never below 75 %), start at the top, and let the wheel/swipe scroll down.
  const start = (rf: ReactFlowInstance<Node<Data>, Edge<Route>>) => {
    const w = box.current?.clientWidth ?? 600;
    const zoom = Math.min(1, Math.max(0.8, (w - 16) / width));
    void rf.setViewport({ x: Math.max(8, (w - width * zoom) / 2), y: 8, zoom });
  };

  return (
    <div ref={box} className={cn('h-[460px] w-full lg:h-[620px]', className)}>
      <ReactFlow
        key={module}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={start}
        panOnScroll
        zoomOnScroll={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.3}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function LegendArrow({ colour, dashed }: { colour: string; dashed?: boolean }) {
  return (
    <svg width="26" height="10" aria-hidden>
      <path d="M1,5 H18" stroke={colour} strokeWidth="1.75" strokeDasharray={dashed ? '5 3' : undefined} />
      <path d="M25,5 L17,1 L17,9 Z" fill={colour} />
    </svg>
  );
}

export function FlowLegend() {
  const { t } = useTranslation();
  const items: [FlowNodeKind | 'off', string][] = [
    ['start', STYLE.start],
    ['action', STYLE.action],
    ['status', STYLE.status],
    ['auto', STYLE.auto],
    ['finished', STYLE.finished],
    ['deadend', STYLE.deadend],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
      {items.map(([k, cls]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={cn('inline-block h-3 w-5', cls)} />
          {t(`engine.legend.${k}`)}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-pill border opacity-35" />
        {t('engine.legend.off')}
      </span>
      <span className="flex items-center gap-1.5">
        <LegendArrow colour="var(--muted-foreground)" />
        {t('engine.legend.next')}
      </span>
      <span className="flex items-center gap-1.5">
        <LegendArrow colour="var(--status-warn)" dashed />
        {t('engine.legend.back')}
      </span>
    </div>
  );
}
