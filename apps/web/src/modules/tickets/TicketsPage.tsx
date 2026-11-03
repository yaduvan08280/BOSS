import { CheckCheck, Clock, Siren, Ticket, TriangleAlert, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { SlipOrTicket, TabStrip } from '@/components/work';
import { useDueLabel, useParamState } from '@/lib/work';
import { cn } from '@/lib/utils';
import { formatShortDateTime } from '@/lib/when';
import { useUsers } from '@/modules/system/api';
import { TICKET_TONE, useTickets, type TicketRow } from './api';
import { RaiseTicket } from './RaiseTicket';
import { TicketDrawer } from './TicketDrawer';

const TABS = ['assigned', 'raise', 'mine', 'all'] as const;

/** Help Tickets (CLAUDE.md §5.4): issue → fix, with SLAs and escalation. */
export function TicketsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { value: tab, params, set } = useParamState('tab', TABS, 'assigned');
  const open = params.get('ticket');
  const tz = me.company.timezone;
  const people = useUsers().data ?? [];
  const names = new Map(people.map((p) => [p.id, p.name]));
  const list = useTickets(tab === 'raise' ? 'assigned' : tab);
  const data = list.data;

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.helpTickets')} subtitle={t('navDesc.helpTickets')} />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5 max-lg:[&>:first-child]:col-span-2">
        <KpiTile
          hero
          label={t('ticket.tile.open')}
          value={data?.tiles.open ?? '—'}
          note={t('ticket.tile.openNote')}
          icon={Wrench}
        />
        <KpiTile
          label={t('ticket.tile.late')}
          value={data?.tiles.late ?? '—'}
          tone={data?.tiles.late ? 'bad' : undefined}
          note={t('ticket.tile.lateNote')}
          icon={TriangleAlert}
        />
        <KpiTile
          label={t('ticket.tile.escalated')}
          value={data?.tiles.escalated ?? '—'}
          tone={data?.tiles.escalated ? 'bad' : undefined}
          note={t('ticket.tile.escalatedNote')}
          icon={Siren}
        />
        <KpiTile
          label={t('ticket.tile.waiting')}
          value={data?.tiles.waiting ?? '—'}
          note={t('ticket.tile.waitingNote')}
          icon={Clock}
        />
        <KpiTile
          label={t('ticket.tile.closedWeek')}
          value={data?.tiles.closedWeek ?? '—'}
          note={t('ticket.tile.closedWeekNote')}
          icon={CheckCheck}
        />
      </div>
      <TabStrip
        tabs={TABS}
        active={tab}
        onChange={(k) => set({ tab: k })}
        label={(k) => t(`ticket.tab.${k}`)}
        counts={{ assigned: data?.counts.assigned, mine: data?.counts.mine }}
      />
      {tab === 'raise' ? (
        <>
          <SlipOrTicket current="ticket" />
          <RaiseTicket
            people={people}
            meId={me.user.id}
            tz={tz}
            fixHours={data?.settings.fixHours ?? 24}
            onRaised={(id) => set({ tab: 'mine', ticket: id })}
          />
        </>
      ) : list.isPending ? (
        <PageSkeleton />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : !data!.tickets.length ? (
        <EmptyState icon={Ticket} title={t(`ticket.empty.${tab}`)} body={t('ticket.emptyBody')} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-card border bg-card">
          {data!.tickets.map((x) => (
            <TicketItem key={x.id} ticket={x} names={names} tz={tz} onOpen={() => set({ ticket: x.id })} />
          ))}
        </ul>
      )}
      {open && <TicketDrawer id={open} people={people} tz={tz} onClose={() => set({ ticket: null })} />}
    </div>
  );
}

function TicketItem({
  ticket: x,
  names,
  tz,
  onOpen,
}: {
  ticket: TicketRow;
  names: Map<string, string>;
  tz: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const due = useDueLabel();
  const live = x.status === 'OPEN' || x.status === 'IN_PROGRESS';
  const late = live && new Date(x.plannedFixAt) < new Date();
  return (
    <li>
      <button
        onClick={onOpen}
        className="grid w-full gap-2 p-4 text-left hover:bg-muted/40 md:grid-cols-[1fr_auto] md:items-center md:gap-6"
      >
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">T#{x.number}</span> · {names.get(x.raiserId)} →{' '}
            {names.get(x.solverId)} · {formatShortDateTime(x.createdAt, tz)}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm font-medium">{x.title}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
          <StatusChip tone={TICKET_TONE[x.status]}>{t(`ticket.status.${x.status}`)}</StatusChip>
          {x.escalationLevel > 0 && live && (
            <StatusChip tone="bad">{t('ticket.escalatedL', { level: x.escalationLevel })}</StatusChip>
          )}
          {live && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                late ? 'font-semibold text-status-bad-fg' : 'text-muted-foreground',
              )}
            >
              <Clock className="size-3.5" /> {due(x.plannedFixAt)}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
