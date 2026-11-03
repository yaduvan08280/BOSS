import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CalendarClock, Hourglass, Phone, Send, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, minutesToHHmm, type EaActionInput, type EaStage } from '@mono/shared';
import { useActionMutation } from '@/lib/work';
import { cn } from '@/lib/utils';
import { DROP_ACTION, type EaBoard, type EaItem } from './api';

const COLUMNS: EaStage[] = [
  'CAPTURED',
  'INFORMATION',
  'SOMEDAY',
  'WAITING',
  'SCHEDULED',
  'DELEGATED',
  'DONE',
];

/** Kanban by stage. Drag a card onto a column to sort it; schedule and delegate open the dialog for details. */
export function EaBoardView({
  board,
  onOpen,
}: {
  board: EaBoard;
  onOpen: (item: EaItem, ask?: 'schedule' | 'delegate') => void;
}) {
  const { t } = useTranslation();
  const act = useActionMutation<EaActionInput>('ea/items', 'ea');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const s = board.settings;
  const columns = COLUMNS.filter(
    (c) =>
      (c !== 'INFORMATION' || s.informationStage || board.counts[c]) &&
      (c !== 'WAITING' || s.waitingStage || board.counts[c]),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const item = board.items.find((i) => i.id === e.active.id);
    const to = e.over?.id as EaStage | undefined;
    if (!item || !to || to === item.stage) return;
    const action = DROP_ACTION[to];
    if (!action || !item.actions.includes(action)) return void toast.error(t('ea.cantMove'));
    if (action === 'schedule' || action === 'delegate') return onOpen(item, action);
    act.mutate({ id: item.id, input: { action } as EaActionInput });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-3">
          {columns.map((c) => (
            <Column
              key={c}
              stage={c}
              count={board.counts[c]}
              cap={c === 'WAITING' ? s.waitingCap : undefined}
            >
              {board.items
                .filter((i) => i.stage === c)
                .map((i) => (
                  <Card key={i.id} item={i} onOpen={() => onOpen(i)} />
                ))}
            </Column>
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function Column({
  stage,
  count,
  cap,
  children,
}: {
  stage: EaStage;
  count: number;
  cap?: number;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const full = cap !== undefined && count >= cap;
  return (
    <section
      ref={setNodeRef}
      aria-label={t(`ea.stage.${stage}`)}
      className={cn(
        'flex w-[264px] shrink-0 flex-col rounded-card bg-muted/60 p-2 transition-colors',
        isOver && 'bg-primary/15 ring-2 ring-primary',
      )}
    >
      <header className="flex items-center justify-between px-1.5 pb-2 pt-1">
        <h3 className="text-sm font-semibold">{t(`ea.stage.${stage}`)}</h3>
        <span
          className={cn(
            'tabular rounded-pill bg-card px-2 text-xs font-semibold',
            full && 'bg-status-bad-bg text-status-bad-fg',
          )}
        >
          {cap !== undefined ? `${count}/${cap}` : count}
        </span>
      </header>
      <p className="px-1.5 pb-2 text-[11px] leading-snug text-muted-foreground">
        {t(`ea.stageHint.${stage}`)}
      </p>
      <div className="flex min-h-24 flex-col gap-2">{children}</div>
    </section>
  );
}

const KIND_ICON = { meeting: Users, call: Phone, review: CalendarClock, task: CalendarClock };

function Card({ item, onOpen }: { item: EaItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const Icon = KIND_ICON[item.kind ?? 'task'];
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn(
        'touch-manipulation rounded-control border bg-card p-3 text-left text-sm shadow-sm hover:border-primary/60',
        isDragging && 'z-50 rotate-1 shadow-lg',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium leading-snug">{item.text}</span>
        <span className="font-mono text-[11px] text-muted-foreground">#{item.number}</span>
      </div>
      {item.stage === 'SCHEDULED' && item.scheduledDate && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-status-info-fg">
          <Icon className="size-3.5" />
          {formatLocalDate(item.scheduledDate)} · {minutesToHHmm(item.slotStart ?? 0)}
        </div>
      )}
      {item.stage === 'WAITING' && item.waitingOn && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Hourglass className="size-3.5" /> {item.waitingOn}
        </div>
      )}
      {item.task && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Send className="size-3.5" />{' '}
          {t('ea.taskShort', { n: item.task.number, status: t(`task.status.${item.task.status}`) })}
        </div>
      )}
      {item.source === 'telegram' && <div className="mt-1 text-[11px] text-muted-foreground">Telegram</div>}
    </button>
  );
}
