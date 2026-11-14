import { ClipboardCheck, History, Pencil, Trash2 } from 'lucide-react';
import { Who } from '@/components/brand';
import { ScrollRow } from '@/components/scroll-row';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useIsPhone } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/form';
import { useModuleSettings } from '@/lib/work';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDateTime, formatShortDateTime, relative } from '@/lib/when';
import { useDepartments, useUsers } from '@/modules/system/api';
import { useChecklistMutation, useMasterChanges, useMasters, useRuns, type Master, type Run } from './api';
import { MasterEditor } from './MasterEditor';
import { RunSheet } from './RunSheet';

const TABS = ['mine', 'all', 'assign', 'master', 'changes'] as const;
type Tab = (typeof TABS)[number];
const TONE = { OPEN: 'info', PENDING_VERIFY: 'warn', DONE: 'ok', MISSED: 'bad' } as const;

function RunList({
  scope,
  names,
  depts,
  tz,
  onOpen,
}: {
  scope: 'mine' | 'all';
  names: Map<string, string>;
  depts: Map<string, string>;
  tz: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const q = useRuns(scope);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const { runs, tiles } = q.data;
  const due = (r: Run) => {
    if (r.status !== 'OPEN') return null;
    const rel = relative(r.plannedAt);
    return (
      <span
        className={cn('text-xs', rel.late ? 'font-semibold text-status-bad-fg' : 'text-muted-foreground')}
      >
        {rel.late ? t('task.overdueBy', { d: rel.text }) : t('chk.left', { d: rel.text })}
      </span>
    );
  };
  const progress = (r: Run) => (
    <div className="w-28">
      <div className="h-1.5 overflow-hidden rounded-pill bg-muted">
        <div
          className="h-full bg-status-ok"
          style={{ width: `${(r.itemsDone / Math.max(1, r.itemsTotal)) * 100}%` }}
        />
      </div>
      <div className="tabular mt-1 text-[11px] text-muted-foreground">
        {t('chk.items_n', { done: r.itemsDone, total: r.itemsTotal })}
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5 max-lg:[&>:first-child]:col-span-2">
        <KpiTile hero label={t('chk.tile.all')} value={tiles.all} />
        <KpiTile
          label={t('chk.tile.dueToday')}
          value={tiles.dueToday}
          note={t('chk.tile.doneToday', { count: tiles.doneToday })}
        />
        <KpiTile
          label={t('chk.tile.overdue')}
          value={tiles.overdue}
          tone={tiles.overdue ? 'bad' : undefined}
          note={t('chk.tile.overdueNote')}
        />
        <KpiTile label={t('chk.tile.toVerify')} value={tiles.toVerify} note={t('chk.tile.toVerifyNote')} />
        <KpiTile label={t('chk.tile.missed')} value={tiles.missed} note={t('chk.tile.missedNote')} />
      </div>
      {runs.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={t('chk.noRuns')} body={t('chk.noRunsBody')} />
      ) : phone ? (
        <ul className="space-y-2">
          {runs.map((r) => (
            <li
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="cursor-pointer rounded-card border bg-card p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.master.name}</div>
                  <div className="text-xs text-muted-foreground">
                    <Who id={r.doerId} name={names.get(r.doerId)} />
                    {r.coveredById && ` (${t('hr.covering')})`} · {formatShortDateTime(r.plannedAt, tz)}
                  </div>
                </div>
                <StatusChip tone={TONE[r.status]}>{t(`chk.status.${r.status}`)}</StatusChip>
              </div>
              <div className="mt-2 flex items-center justify-between">
                {progress(r)}
                {due(r)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {['checklist', 'doer', 'planned', 'due', 'status', 'progress', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-medium">
                    {h && t(`chk.col.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => onOpen(r.id)}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.master.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.master.code}
                      {r.master.departmentId ? ` · ${depts.get(r.master.departmentId) ?? ''}` : ''}
                    </div>
                  </td>
                  <td className="px-3 text-xs">
                    <Who id={r.doerId} name={names.get(r.doerId)} />
                    {r.coveredById && ` (${t('hr.covering')})`}
                  </td>
                  <td className="tabular px-3 text-xs">{formatShortDateTime(r.plannedAt, tz)}</td>
                  <td className="px-3">{due(r)}</td>
                  <td className="px-3">
                    <StatusChip tone={TONE[r.status]}>{t(`chk.status.${r.status}`)}</StatusChip>
                  </td>
                  <td className="px-3">{progress(r)}</td>
                  <td className="px-3 text-right">
                    <Button size="sm" variant={r.status === 'OPEN' ? 'primary' : 'secondary'}>
                      {r.status === 'OPEN' ? t('chk.open') : t('chk.view')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MasterList({ names, onEdit }: { names: Map<string, string>; onEdit: (m: Master) => void }) {
  const { t } = useTranslation();
  const q = useMasters();
  const toggle = useChecklistMutation(({ id, active }: { id: string; active: boolean }) =>
    api(`/api/checklists/masters/${id}`, { method: 'PATCH', body: { active } }),
  );
  const remove = useChecklistMutation(
    (id: string) => api(`/api/checklists/masters/${id}`, { method: 'DELETE' }),
    t('org.deleted'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  if (!q.data.length) return <EmptyState icon={ClipboardCheck} title={t('chk.noMasters')} />;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {q.data.map((m) => (
        <Card key={m.id} className={cn('flex flex-col gap-2 p-4', !m.active && 'opacity-60')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-xs text-muted-foreground">{m.code}</div>
              <div className="truncate font-semibold">{m.name}</div>
            </div>
            <Switch
              checked={m.active}
              onCheckedChange={(active) => toggle.mutate({ id: m.id, active })}
              aria-label={t('chk.active')}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {t(`chk.freq.${m.frequency.type}`)} · {m.dueTime} · {t('chk.items')}: {m.items.length}
          </div>
          <div className="text-xs">{m.doerIds.map((id) => names.get(id)).join(', ')}</div>
          <div className="mt-auto flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => onEdit(m)}>
              <Pencil /> {t('org.edit')}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => remove.mutate(m.id)}
              aria-label={t('org.delete')}
            >
              <Trash2 />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Changes({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const q = useMasterChanges();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError || !q.data.length) return <EmptyState icon={History} title={t('chk.noChanges')} />;
  const diff = (b: unknown, a: unknown) => {
    const before = (b ?? {}) as Record<string, unknown>;
    const after = (a ?? {}) as Record<string, unknown>;
    return Object.keys(after).filter(
      (k) =>
        !['updatedAt', 'createdAt', 'dueMin'].includes(k) &&
        JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
  };
  return (
    <Card className="divide-y">
      {q.data.map((c) => (
        <div key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
          <div>
            <span className="font-medium">
              {(c.after as { name?: string } | null)?.name ?? (c.before as { name?: string } | null)?.name}
            </span>{' '}
            · {t(`chk.change.${c.action.split('.')[1]}`)}
            {c.action === 'checklist.master_changed' && (
              <span className="text-muted-foreground">
                {' '}
                —{' '}
                {diff(c.before, c.after)
                  .map((k) => t(`chk.field.${k}`, { defaultValue: k }))
                  .join(', ')}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {c.actorName} · {formatDateTime(c.createdAt, tz)}
          </div>
        </div>
      ))}
    </Card>
  );
}

/** Checklists (CLAUDE.md §5.2). */
export function ChecklistsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'mine') as Tab;
  const open = params.get('run');
  const [editing, setEditing] = useState<Master | null>(null);
  const tz = me.company.timezone;
  const settings = useModuleSettings('checklist');
  const users = useUsers().data;
  const deptList = useDepartments().data;
  const people = useMemo(() => users ?? [], [users]);
  const departments = useMemo(() => deptList ?? [], [deptList]);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const depts = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const canManage = me.user.permissions.some(
    (p) => p === '*' || p === 'checklist.edit' || p === 'checklist.admin',
  );
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const tabs = TABS.filter((k) => canManage || k === 'mine' || k === 'all');
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.checklists')} subtitle={t('navDesc.checklists')} />
      <ScrollRow watch={tab}>
        <div className="flex w-max gap-1 border-b">
          {tabs.map((k) => (
            <button
              key={k}
              onClick={() => (setEditing(null), set({ tab: k }))}
              className={cn(
                '-mb-px h-11 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                tab === k
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`chk.tab.${k}`)}
            </button>
          ))}
        </div>
      </ScrollRow>
      {(tab === 'mine' || tab === 'all') && (
        <RunList
          key={tab}
          scope={tab}
          names={names}
          depts={depts}
          tz={tz}
          onOpen={(id) => set({ run: id })}
        />
      )}
      {tab === 'assign' && (
        <MasterEditor
          key={settings.data?.missedAfterHours ?? 'loading'}
          windowHours={settings.data?.missedAfterHours}
          people={people}
          departments={departments}
          tz={tz}
          onDone={() => set({ tab: 'master' })}
        />
      )}
      {tab === 'master' &&
        (editing ? (
          <MasterEditor
            key={editing.id}
            master={editing}
            people={people}
            departments={departments}
            tz={tz}
            onDone={() => setEditing(null)}
          />
        ) : (
          <MasterList names={names} onEdit={setEditing} />
        ))}
      {tab === 'changes' && <Changes tz={tz} />}
      {open && <RunSheet id={open} names={names} tz={tz} onClose={() => set({ run: null })} />}
    </div>
  );
}
