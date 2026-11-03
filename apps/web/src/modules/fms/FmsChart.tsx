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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, CircleCheck, Diamond, Plus, Play, ShieldCheck, Truck, User } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { END, nextStepKey, type FlowDefinition, type StepType } from '@mono/shared';
import { cn } from '@/lib/utils';

type Data = {
  label: string;
  sub: string;
  type: StepType | 'start' | 'end';
  n: number;
  fix: boolean;
  selected: boolean;
  onSelect?: () => void;
  onInsert?: () => void;
};
const W = 200;
const H = 58;
const ICON = {
  TASK: User,
  DECISION: Diamond,
  APPROVAL: ShieldCheck,
  OUTSIDE: Truck,
  AUTO: Bot,
  start: Play,
  end: CircleCheck,
};
const TONE: Record<Data['type'], string> = {
  TASK: 'bg-card border',
  DECISION: 'bg-status-warn-bg text-status-warn-fg border border-status-warn',
  APPROVAL: 'bg-status-over-bg text-status-over-fg border border-status-over',
  OUTSIDE: 'bg-muted border',
  AUTO: 'bg-muted border border-dashed',
  start: 'bg-foreground text-background',
  end: 'bg-status-ok-bg text-status-ok-fg',
};

function StepNode({ data }: NodeProps<Node<Data>>) {
  const { t } = useTranslation();
  const Icon = ICON[data.type];
  return (
    <div
      style={{ width: W, minHeight: H }}
      onClick={data.onSelect}
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-card px-3 py-2 text-left text-xs shadow-sm',
        TONE[data.type],
        data.selected && 'ring-2 ring-primary',
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-border" />
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">
          {data.n > 0 ? `${data.n}. ${data.label}` : data.label}
        </span>
        {data.sub && <span className="block truncate opacity-75">{data.sub}</span>}
      </span>
      {data.fix && (
        <span
          className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-status-bad text-[11px] font-bold text-white"
          title={t('fms.b.needsFix')}
        >
          !
        </span>
      )}
      {data.onInsert && (
        <button
          type="button"
          aria-label={t('fms.b.insertAfter', { step: data.label })}
          onClick={(e) => (e.stopPropagation(), data.onInsert?.())}
          className="absolute -bottom-3 left-1/2 z-10 grid size-6 -translate-x-1/2 place-items-center rounded-full border bg-card text-foreground shadow hover:bg-primary hover:text-primary-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-border" />
    </div>
  );
}
const nodeTypes = { step: StepNode };

/** The flow as a chart: Yes/No branches, rejections going back, red badges on steps to fix. */
export function FmsChart({
  def,
  names,
  toFix,
  selected,
  onSelect,
  onInsert,
}: {
  def: FlowDefinition;
  names: Map<string, string>;
  toFix: Set<string>;
  selected: string | null;
  onSelect: (key: string) => void;
  onInsert: (afterKey: string) => void;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const { nodes, edges, width } = useMemo(() => {
    const g = new Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 56, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const ids = ['__start', ...def.steps.map((s) => s.key), END];
    ids.forEach((id) => g.setNode(id, { width: W, height: H }));
    const edges: Edge[] = [];
    const link = (from: string, to: string, label?: string, dashed = false) => {
      g.setEdge(from, to);
      edges.push({
        id: `${from}-${to}-${label ?? ''}`,
        source: from,
        target: to,
        type: 'smoothstep',
        label,
        labelStyle: { fontSize: 11, fontWeight: 600 },
        style: dashed ? { strokeDasharray: '4 4', stroke: 'var(--status-bad)' } : { strokeWidth: 1.5 },
      });
    };
    if (def.steps[0]) link('__start', def.steps[0].key);
    for (const s of def.steps) {
      if (s.type === 'DECISION') {
        if (s.yes) link(s.key, s.yes, t('fms.yes'));
        if (s.no) link(s.key, s.no, t('fms.no'));
      } else {
        link(s.key, nextStepKey(def, s.key));
        if (s.type === 'APPROVAL') link(s.key, nextStepKey(def, s.key, 'rejected'), t('fms.rejected'), true);
      }
    }
    layout(g);
    const time = (s: (typeof def.steps)[number]) =>
      s.time
        ? s.time.anchor === 'fixed'
          ? `@ ${s.time.at}`
          : `${s.time.value} ${t(`fms.unitShort.${s.time.unit}`)}`
        : '';
    const nodes: Node<Data>[] = ids.map((id) => {
      const p = g.node(id);
      const i = def.steps.findIndex((s) => s.key === id);
      const s = def.steps[i];
      const who = s
        ? s.starter
          ? t('fms.b.starterShort')
          : s.doerIds.map((d) => names.get(d) ?? '?').join(', ')
        : '';
      return {
        id,
        type: 'step',
        position: { x: p.x - W / 2, y: p.y - H / 2 },
        data: s
          ? {
              label: s.name,
              sub: [who, time(s)].filter(Boolean).join(' · '),
              type: s.type,
              n: i + 1,
              fix: toFix.has(s.key),
              selected: selected === s.key,
              onSelect: () => onSelect(s.key),
              onInsert: () => onInsert(s.key),
            }
          : {
              label: id === END ? t('fms.b.end') : t('fms.b.startForm'),
              sub: '',
              type: id === END ? 'end' : 'start',
              n: 0,
              fix: false,
              selected: false,
            },
      };
    });
    return { nodes, edges, width: g.graph().width ?? 600 };
  }, [def, names, toFix, selected, onSelect, onInsert, t]);

  return (
    <div ref={box} className="h-[560px] w-full rounded-card border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(rf) => {
          // Readable first: fit the width (not below 80 %), start at the top; scroll for the rest.
          const w = box.current?.clientWidth ?? 600;
          const zoom = Math.min(1, Math.max(0.8, (w - 16) / width));
          void rf.setViewport({ x: Math.max(8, (w - width * zoom) / 2), y: 8, zoom });
        }}
        minZoom={0.3}
        nodesDraggable={false}
        nodesConnectable={false}
        panOnScroll
        zoomOnScroll={false}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
