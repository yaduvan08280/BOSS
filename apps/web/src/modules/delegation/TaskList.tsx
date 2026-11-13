import {
  Ban,
  CalendarClock,
  Check,
  CheckCheck,
  Forward,
  MessageSquarePlus,
  Paperclip,
  Search,
  ShieldCheck,
  Undo2,
  UserRoundCog,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { weekOf, type OrgPerson, type TaskAction } from '@mono/shared';
import { personLabel } from '@/lib/people';
import { DateInput } from '@/components/ui/date-input';
import { Avatar } from '@/components/brand';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { useIsPhone } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { formatShortDateTime, relative } from '@/lib/when';
import { ActionDialog } from './ActionDialog';
import { DIALOG_ACTIONS, useTaskAction, useTasks, type TaskQuery, type TaskRow } from './api';
import { TaskStatusChips } from './TaskStatus';

const ICON: Partial<Record<TaskAction, typeof Check>> = {
  accept: Check,
  verify: ShieldCheck,
  markDone: CheckCheck,
  moveDate: CalendarClock,
  addFollowUp: MessageSquarePlus,
  reject: Undo2,
  reopen: Undo2,
  reassign: UserRoundCog,
  passOn: Forward,
  cancel: Ban,
};
/** Which buttons show on a row, in this order (decline only inside the drawer). */
const ROW_ACTIONS: TaskAction[] = [
  'accept',
  'markDone',
  'passOn',
  'verify',
  'addFollowUp',
  'moveDate',
  'reassign',
  'cancel',
];

export function TaskList({
  tab,
  people,
  tz,
  onOpen,
  defaultRange = 'all',
}: {
  tab: TaskQuery['tab'];
  people: OrgPerson[];
  tz: string;
  onOpen: (id: string) => void;
  /** "Reports open on" from the flow designer. */
  defaultRange?: 'week' | 'all';
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const [q, setQ] = useState('');
  const [range, setRange] = useState<'week' | 'all' | 'custom'>(defaultRange);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [doerId, setDoerId] = useState('');
  const [scope, setScope] = useState<TaskQuery['scope']>(undefined);
  const [dialog, setDialog] = useState<{ task: TaskRow; action: TaskAction } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const act = useTaskAction();

  const week = weekOf(new Date(), tz);
  const query: TaskQuery = {
    tab,
    q: q.trim() || undefined,
    doerId: doerId || undefined,
    scope,
    from:
      range === 'week'
        ? week.from.toISOString()
        : range === 'custom' && from
          ? new Date(`${from}T00:00:00`).toISOString()
          : undefined,
    to:
      range === 'week'
        ? week.to.toISOString()
        : range === 'custom' && to
          ? new Date(`${to}T23:59:59`).toISOString()
          : undefined,
  };
  const list = useTasks(query);

  const run = (task: TaskRow, action: TaskAction) => {
    if (DIALOG_ACTIONS.includes(action)) setDialog({ task, action });
    else if (action === 'accept' || action === 'verify') act.mutate({ id: task.id, input: { action } });
  };
  const bulk = (action: 'accept' | 'verify') => {
    for (const id of picked) {
      const task = list.data?.tasks.find((x) => x.id === id);
      if (task?.actions.includes(action)) act.mutate({ id, input: { action } });
    }
    setPicked(new Set());
  };

  const buttons = (task: TaskRow) => (
    <div className={cn('flex justify-end gap-0.5', phone ? 'flex-wrap' : 'flex-nowrap')}>
      {ROW_ACTIONS.filter((a) => task.actions.includes(a)).map((a) => {
        const Icon = ICON[a] ?? Check;
        const primary = a === 'accept' || a === 'verify' || a === 'markDone';
        return (
          <Button
            key={a}
            size={primary ? 'sm' : 'icon-sm'}
            variant={primary ? 'primary' : 'ghost'}
            title={t(`task.act.${a}`)}
            aria-label={t(`task.act.${a}`)}
            onClick={(e) => (e.stopPropagation(), run(task, a))}
          >
            <Icon /> {primary && <span>{t(`task.act.${a}`)}</span>}
          </Button>
        );
      })}
    </div>
  );

  const when = (task: TaskRow) => {
    const r = relative(task.plannedAt);
    const late = r.late && !task.doneAt;
    return (
      <div className="whitespace-nowrap">
        <div className="tabular text-sm">{formatShortDateTime(task.plannedAt, tz)}</div>
        <div className={cn('text-xs', late ? 'font-semibold text-status-bad-fg' : 'text-muted-foreground')}>
          {task.doneAt
            ? t('task.doneAt', { at: formatShortDateTime(task.doneAt, tz) })
            : late
              ? t('task.overdueBy', { d: r.text })
              : t('task.inTime', { d: r.text })}
          {task.revisionCount > 0 && ` · ${t('task.revised', { count: task.revisionCount })}`}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control border bg-card px-3 sm:max-w-xs">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('task.search')}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <Select
          value={doerId}
          onChange={(e) => setDoerId(e.target.value)}
          className="h-10 w-auto sm:h-10"
          aria-label={t('task.doer')}
        >
          <option value="">{t('task.allDoers')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {personLabel(p)}
            </option>
          ))}
        </Select>
        <div className="flex rounded-control bg-muted p-1">
          {(['week', 'all', 'custom'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'h-8 rounded-[calc(var(--radius)*0.5)] px-3 text-xs font-medium',
                range === r ? 'bg-card shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t(`task.range.${r}`)}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-1">
            <DateInput
              value={from}
              onChange={(v) => setFrom(v)}
              className="w-40"
              aria-label={t('task.from')}
            />
            <span className="text-muted-foreground">–</span>
            <DateInput value={to} onChange={(v) => setTo(v)} className="w-40" aria-label={t('task.to')} />
          </div>
        )}
        {list.data?.scope && list.data.scope !== 'mine' && (
          <Select
            value={scope ?? list.data.scope}
            onChange={(e) => setScope(e.target.value as TaskQuery['scope'])}
            className="h-10 w-auto sm:h-10"
            aria-label={t('task.scope.label')}
          >
            {(['mine', 'team', 'all'] as const)
              .filter((s) => s !== 'all' || list.data!.scope === 'all')
              .map((s) => (
                <option key={s} value={s}>
                  {t(`task.scope.${s}`)}
                </option>
              ))}
          </Select>
        )}
      </div>

      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border bg-card p-2 text-sm">
          <span className="px-2 font-medium">{t('org.users.selected', { count: picked.size })}</span>
          <Button size="sm" onClick={() => bulk('accept')}>
            <Check /> {t('task.act.accept')}
          </Button>
          <Button size="sm" onClick={() => bulk('verify')}>
            <ShieldCheck /> {t('task.act.verify')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
            {t('common.close')}
          </Button>
        </div>
      )}

      {list.isPending ? (
        <PageSkeleton />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : list.data.tasks.length === 0 ? (
        <EmptyState icon={CheckCheck} title={t(`task.empty.${tab}`)} />
      ) : phone ? (
        <ul className="space-y-2">
          {list.data.tasks.map((task) => (
            <li
              key={task.id}
              onClick={() => onOpen(task.id)}
              className="cursor-pointer rounded-card border bg-card p-3.5"
            >
              <div className="flex items-start gap-3">
                <Avatar id={task.doerId} name={names.get(task.doerId) ?? '?'} className="size-9" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">#{task.number}</span> · {names.get(task.doerId)} ·{' '}
                    {t('task.by', { name: names.get(task.creatorId) ?? '?' })}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-sm font-medium">{task.description}</div>
                </div>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="space-y-1">
                  {when(task)}
                  <TaskStatusChips t={task} names={names} tz={tz} />
                </div>
                {buttons(task)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3" />
                {['task', 'status', 'description', 'planned', 'assignedBy', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">
                    {h && t(`task.col.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.data.tasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => onOpen(task.id)}
                  className="cursor-pointer align-top hover:bg-muted/40"
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={picked.has(task.id)}
                      onChange={() =>
                        setPicked((s) =>
                          s.has(task.id) ? (s.delete(task.id), new Set(s)) : new Set(s.add(task.id)),
                        )
                      }
                      aria-label={`#${task.number}`}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar id={task.doerId} name={names.get(task.doerId) ?? '?'} className="size-8" />
                      <div>
                        <div className="font-medium">
                          <span className="font-mono text-xs text-muted-foreground">#{task.number}</span>{' '}
                          {names.get(task.doerId)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('task.by', { name: names.get(task.creatorId) ?? '?' })}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <TaskStatusChips t={task} names={names} tz={tz} />
                  </td>
                  <td className="max-w-sm px-3 py-3">
                    <div className="line-clamp-2">{task.description}</div>
                    {task.files > 0 && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Paperclip className="size-3" /> {task.files}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">{when(task)}</td>
                  <td className="px-3 py-3 text-xs">{names.get(task.creatorId)}</td>
                  <td className="px-3 py-3">{buttons(task)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && (
        <ActionDialog
          task={dialog.task}
          action={dialog.action}
          people={people}
          tz={tz}
          verifierName={dialog.task.verifierId ? names.get(dialog.task.verifierId) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
