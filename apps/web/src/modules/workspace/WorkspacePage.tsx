import { useQuery } from '@tanstack/react-query';
import { CheckCheck, ClipboardCheck, ListTodo, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatShortDateTime, relative } from '@/lib/when';
import type { Run } from '../checklists/api';
import type { TaskRow } from '../delegation/api';

/** Everything waiting on me, in one list: tasks to do or accept, things to verify, checklists due. */
export function WorkspacePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const tasks = useQuery({
    queryKey: ['tasks', 'list', 'workspace'],
    queryFn: () => api<{ tasks: TaskRow[] }>('/api/tasks?scope=mine&tab=all'),
  });
  const runs = useQuery({
    queryKey: ['checklists', 'runs', 'mine'],
    queryFn: () => api<{ runs: Run[] }>('/api/checklists/runs?scope=mine'),
  });
  if (tasks.isPending || runs.isPending) return <PageSkeleton />;
  const uid = me.user.id;
  const todo = (tasks.data?.tasks ?? []).filter(
    (x) => x.doerId === uid && (x.status === 'OPEN' || x.status === 'AWAITING_ACCEPTANCE'),
  );
  const verify = (tasks.data?.tasks ?? []).filter((x) => x.actions.includes('verify'));
  const due = (runs.data?.runs ?? []).filter(
    (r) =>
      (r.doerId === uid && r.status === 'OPEN') || (r.verifierId === uid && r.status === 'PENDING_VERIFY'),
  );
  const item = (
    key: string,
    to: string,
    icon: React.ReactNode,
    title: string,
    sub: string,
    at: string,
    late: boolean,
  ) => (
    <li key={key}>
      <Link to={to} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-soft-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{sub}</span>
        </span>
        <span className="text-right text-xs">
          <span className="tabular block">{formatShortDateTime(at, tz)}</span>
          {late && <StatusChip tone="bad">{t('task.overdue')}</StatusChip>}
        </span>
      </Link>
    </li>
  );
  const total = todo.length + verify.length + due.length;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t('nav.myWorkspace')} subtitle={t('ws.subtitle', { count: total })} />
      {total === 0 ? (
        <EmptyState icon={CheckCheck} title={t('ws.emptyTitle')} body={t('ws.emptyBody')} />
      ) : (
        <>
          {todo.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('ws.tasks')}</h2>
              <Card className="divide-y overflow-hidden">
                <ul className="divide-y">
                  {todo.map((x) =>
                    item(
                      x.id,
                      `/delegation?task=${x.id}`,
                      <ListTodo className="size-4" />,
                      `#${x.number} ${x.description}`,
                      x.status === 'AWAITING_ACCEPTANCE'
                        ? t('task.status.AWAITING_ACCEPTANCE')
                        : t('task.status.OPEN'),
                      x.plannedAt,
                      relative(x.plannedAt).late,
                    ),
                  )}
                </ul>
              </Card>
            </section>
          )}
          {verify.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('ws.verify')}</h2>
              <Card className="overflow-hidden">
                <ul className="divide-y">
                  {verify.map((x) =>
                    item(
                      x.id,
                      `/delegation?task=${x.id}`,
                      <ShieldCheck className="size-4" />,
                      `#${x.number} ${x.description}`,
                      x.doneNote ?? '',
                      x.doneAt ?? x.plannedAt,
                      false,
                    ),
                  )}
                </ul>
              </Card>
            </section>
          )}
          {due.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('ws.checklists')}</h2>
              <Card className="overflow-hidden">
                <ul className="divide-y">
                  {due.map((r) =>
                    item(
                      r.id,
                      `/checklists?run=${r.id}`,
                      <ClipboardCheck className="size-4" />,
                      r.master.name,
                      t('chk.items_n', { done: r.itemsDone, total: r.itemsTotal }),
                      r.plannedAt,
                      r.status === 'OPEN' && relative(r.plannedAt).late,
                    ),
                  )}
                </ul>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
