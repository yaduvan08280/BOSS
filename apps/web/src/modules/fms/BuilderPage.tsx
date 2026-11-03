import { Archive, ArchiveRestore, Copy, GitBranch, Loader2, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TabStrip } from '@/components/work';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useParamState, useWorkMutation } from '@/lib/work';
import { formatDateTime } from '@/lib/when';
import { useUsers } from '@/modules/system/api';
import { useFlows, type FlowListItem } from './api';

const TABS = ['all', 'published', 'drafts', 'archived'] as const;

/** FMS Builder list (CLAUDE.md §6.2): every flow with its status, steps, people and readiness. */
export function BuilderPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { value: tab, set } = useParamState('tab', TABS, 'all');
  const q = useFlows();
  const names = new Map((useUsers().data ?? []).map((p) => [p.id, p.name]));
  const [creating, setCreating] = useState(false);
  const flows = (q.data ?? []).filter((f) =>
    tab === 'all'
      ? f.status !== 'ARCHIVED'
      : tab === 'published'
        ? f.status === 'PUBLISHED'
        : tab === 'drafts'
          ? f.status === 'DRAFT' || f.dirty
          : f.status === 'ARCHIVED',
  );
  const counts = {
    all: q.data?.filter((f) => f.status !== 'ARCHIVED').length,
    published: q.data?.filter((f) => f.status === 'PUBLISHED').length,
    drafts: q.data?.filter((f) => f.status === 'DRAFT' || f.dirty).length,
    archived: q.data?.filter((f) => f.status === 'ARCHIVED').length,
  };
  const dup = useWorkMutation(
    (id: string) => api<{ id: string }>(`/api/fms/flows/${id}/duplicate`, { method: 'POST' }),
    [['fms']],
  );
  const archive = useWorkMutation(
    ({ id, archive }: { id: string; archive: boolean }) =>
      api(`/api/fms/flows/${id}/archive`, { method: 'POST', body: { archive } }),
    [['fms']],
  );

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.fmsBuilder')} subtitle={t('navDesc.fmsBuilder')} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TabStrip
          tabs={TABS}
          active={tab}
          onChange={(k) => set({ tab: k })}
          label={(k) => t(`fms.b.list.${k}`)}
          counts={counts}
        />
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus /> {t('fms.b.newFlow')}
        </Button>
      </div>
      {q.isPending ? (
        <PageSkeleton />
      ) : !flows.length ? (
        <EmptyState icon={GitBranch} title={t('fms.b.noFlows')} body={t('fms.b.noFlowsBody')} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-card border bg-card">
          {flows.map((f) => (
            <FlowRow
              key={f.id}
              f={f}
              tz={me.company.timezone}
              names={names}
              onOpen={() => navigate(`/fms/builder/${f.id}`)}
              onDuplicate={() => dup.mutate(f.id, { onSuccess: (r) => navigate(`/fms/builder/${r.id}`) })}
              onArchive={() => archive.mutate({ id: f.id, archive: f.status !== 'ARCHIVED' })}
            />
          ))}
        </ul>
      )}
      {creating && (
        <NewFlowDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/fms/builder/${id}`)}
        />
      )}
    </div>
  );
}

function FlowRow({
  f,
  tz,
  names,
  onOpen,
  onDuplicate,
  onArchive,
}: {
  f: FlowListItem;
  tz: string;
  names: Map<string, string>;
  onOpen: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const missing = Object.entries(f.readiness.checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => t(`fms.ready.${k}`));
  return (
    <li className="grid gap-3 p-4 md:grid-cols-[1.6fr_1fr_auto] md:items-center">
      <button className="min-w-0 text-left" onClick={onOpen}>
        <div className="text-xs text-muted-foreground">
          <span className="font-mono">{f.code}</span> · {t('fms.b.nSteps', { count: f.steps })} ·{' '}
          {formatDateTime(f.updatedAt, tz)}
        </div>
        <div className="truncate text-sm font-semibold">{f.name}</div>
        <div className={cn('mt-0.5 text-xs', missing.length ? 'text-status-warn-fg' : 'text-status-ok-fg')}>
          {missing.length ? missing.join(' · ') : t('fms.b.allInPlace')}
        </div>
      </button>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <div className="h-1.5 w-24 overflow-hidden rounded-pill bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${(f.readiness.score / f.readiness.of) * 100}%` }}
            />
          </div>
          {f.readiness.score}/{f.readiness.of}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {f.doers
            .slice(0, 4)
            .map((d) => names.get(d) ?? '?')
            .join(', ')}
          {f.doers.length > 4 && ` +${f.doers.length - 4}`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
        <StatusChip tone={f.status === 'PUBLISHED' ? 'ok' : f.status === 'ARCHIVED' ? 'neutral' : 'warn'}>
          {f.status === 'PUBLISHED'
            ? t('fms.b.liveN', { v: f.version, n: f.running })
            : t(`fms.flowStatus.${f.status}`)}
        </StatusChip>
        {f.late > 0 && <StatusChip tone="bad">{t('fms.b.lateN', { n: f.late })}</StatusChip>}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('fms.b.edit')}
          title={t('fms.b.edit')}
          onClick={onOpen}
        >
          <Pencil />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('fms.b.duplicate')}
          title={t('fms.b.duplicate')}
          onClick={onDuplicate}
        >
          <Copy />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={f.status === 'ARCHIVED' ? t('fms.b.restore') : t('fms.b.archive')}
          title={f.status === 'ARCHIVED' ? t('fms.b.restore') : t('fms.b.archive')}
          onClick={onArchive}
        >
          {f.status === 'ARCHIVED' ? <ArchiveRestore /> : <Archive />}
        </Button>
      </div>
    </li>
  );
}

function NewFlowDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [runName, setRunName] = useState('');
  const create = useWorkMutation(
    () =>
      api<{ id: string }>('/api/fms/flows', {
        method: 'POST',
        body: { meta: { name, runName: runName || 'Record' } },
      }),
    [['fms']],
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('fms.b.newFlow')}
      footer={
        <Button
          variant="primary"
          disabled={name.trim().length < 2 || create.isPending}
          onClick={() => create.mutate(undefined, { onSuccess: (r) => onCreated(r.id) })}
        >
          {create.isPending && <Loader2 className="animate-spin" />} {t('fms.b.create')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('fms.b.name')}>
          <Input
            autoFocus
            placeholder={t('fms.b.namePh')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('fms.d.runName')} hint={t('fms.d.runNameHint')}>
          <Input
            placeholder={t('fms.b.runNamePh')}
            value={runName}
            onChange={(e) => setRunName(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
