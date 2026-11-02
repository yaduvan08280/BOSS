import { Graph, layout } from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
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
      style={{ width: w, minHeight: h }}
      className={cn(
        'flex flex-col items-center justify-center px-2.5 py-1 text-center text-[13px] leading-tight shadow-sm',
        STYLE[data.kind],
        data.off && 'opacity-35 grayscale',
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-border" />
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
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-border" />
    </div>
  );
}
const nodeTypes = { flow: FlowNode };

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
    g.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 46, marginx: 16, marginy: 16 });
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
    const nodes: Node<Data>[] = graph.nodes.map((n) => {
      const p = g.node(n.id);
      return {
        id: n.id,
        type: 'flow',
        position: { x: p.x - SIZE[n.kind][0] / 2, y: p.y - SIZE[n.kind][1] / 2 },
        data: {
          label: nodeLabel(t, module, n.kind, n.key),
          kind: n.kind,
          off: n.off,
          roles: n.kind === 'action' ? roleText(n.roles) : '',
        },
      };
    });
    const edges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: !e.off && e.source === 'start',
      style: e.off ? { strokeDasharray: '4 4', opacity: 0.35 } : { strokeWidth: 1.5 },
    }));
    return { nodes, edges, width: g.graph().width ?? 600 };
  }, [graph, module, t]);
  // Readable first: fit the width (never below 75 %), start at the top, and let the wheel/swipe scroll down.
  const start = (rf: ReactFlowInstance<Node<Data>, Edge>) => {
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
    </div>
  );
}
