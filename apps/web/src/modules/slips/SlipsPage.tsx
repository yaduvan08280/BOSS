import { CheckCircle2, Clock, Inbox, NotebookPen, TriangleAlert, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { TabStrip } from '@/components/work';
import { useDueLabel, useParamState } from '@/lib/work';
import { cn } from '@/lib/utils';
import { formatShortDateTime } from '@/lib/when';
import { useUsers } from '@/modules/system/api';
import { SLIP_TONE, useSlips, type SlipRow } from './api';
import { RaiseSlip } from './RaiseSlip';
import { SlipDrawer } from './SlipDrawer';

const TABS = ['inbox', 'raise', 'mine', 'all'] as const;

/** Help Slips (CLAUDE.md §5.3): problem → solutions → decision → a delegation task. */
export function SlipsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { value: tab, params, set } = useParamState('tab', TABS, 'inbox');
  const open = params.get('slip');
  const tz = me.company.timezone;
  const people = useUsers().data ?? [];
  const names = new Map(people.map((p) => [p.id, p.name]));
  const list = useSlips(tab === 'raise' ? 'inbox' : tab);
  const data = list.data;

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.helpSlips')} subtitle={t('navDesc.helpSlips')} />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5 max-lg:[&>:first-child]:col-span-2">
        <KpiTile
          hero
          label={t('slip.tile.withMe')}
          value={data?.tiles.withMe ?? '—'}
          note={t('slip.tile.withMeNote')}
          icon={Inbox}
        />
        <KpiTile
          label={t('slip.tile.open')}
          value={data?.tiles.open ?? '—'}
          note={t('slip.tile.openNote')}
          icon={NotebookPen}
        />
        <KpiTile
          label={t('slip.tile.late')}
          value={data?.tiles.late ?? '—'}
          tone={data?.tiles.late ? 'bad' : undefined}
          note={t('slip.tile.lateNote')}
          icon={TriangleAlert}
        />
        <KpiTile
          label={t('slip.tile.approved')}
          value={data?.tiles.approved ?? '—'}
          note={t('slip.tile.approvedNote')}
          icon={CheckCircle2}
        />
        <KpiTile
          label={t('slip.tile.rejected')}
          value={data?.tiles.rejected ?? '—'}
          note={t('slip.tile.rejectedNote')}
          icon={XCircle}
        />
      </div>
      <TabStrip
        tabs={TABS}
        active={tab}
        onChange={(k) => set({ tab: k })}
        label={(k) => t(`slip.tab.${k}`)}
        counts={{ inbox: data?.counts.inbox, mine: data?.counts.mine }}
      />
      {tab === 'raise' ? (
        <RaiseSlip
          required={data?.settings.solutionsRequired ?? 3}
          onRaised={(id) => set({ tab: 'mine', slip: id })}
        />
      ) : list.isPending ? (
        <PageSkeleton />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : !data!.slips.length ? (
        <EmptyState icon={NotebookPen} title={t(`slip.empty.${tab}`)} body={t('slip.emptyBody')} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-card border bg-card">
          {data!.slips.map((s) => (
            <SlipItem key={s.id} slip={s} names={names} tz={tz} onOpen={() => set({ slip: s.id })} />
          ))}
        </ul>
      )}
      {open && <SlipDrawer id={open} people={people} tz={tz} onClose={() => set({ slip: null })} />}
    </div>
  );
}

function SlipItem({
  slip,
  names,
  tz,
  onOpen,
}: {
  slip: SlipRow;
  names: Map<string, string>;
  tz: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const due = useDueLabel();
  const late = slip.waitingOn && new Date(slip.waitingOn.dueAt) < new Date();
  return (
    <li>
      <button
        onClick={onOpen}
        className="grid w-full gap-2 p-4 text-left hover:bg-muted/40 md:grid-cols-[1fr_auto] md:items-center md:gap-6"
      >
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">#{slip.number}</span> · {names.get(slip.raiserId)} ·{' '}
            {formatShortDateTime(slip.createdAt, tz)}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm font-medium">{slip.problem}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t('slip.nSolutions', { count: slip.solutions.length })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
          <StatusChip tone={SLIP_TONE[slip.status]}>{t(`slip.status.${slip.status}`)}</StatusChip>
          {slip.waitingOn && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                late ? 'font-semibold text-status-bad-fg' : 'text-muted-foreground',
              )}
            >
              <Clock className="size-3.5" />
              {names.get(slip.waitingOn.userId)} · {due(slip.waitingOn.dueAt)}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
