import { CalendarClock, ClipboardList, Hourglass, Inbox, Loader2, Plus, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, localDate, type Me } from '@mono/shared';
import { DictateButton } from '@/components/dictate';
import { ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TabStrip } from '@/components/work';
import { useParamState, useWorkMutation } from '@/lib/work';
import { api } from '@/lib/api';
import { useUsers } from '@/modules/system/api';
import { useEaBoard, type EaItem } from './api';
import { EaBoardView } from './EaBoardView';
import { EaItemDialog } from './EaItemDialog';
import { WeekGrid } from './WeekGrid';

const TABS = ['board', 'week'] as const;

/** EA System (CLAUDE.md §5.5): one-line captures, sorted by the EA into stages and the owner's week. */
export function EaPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { value: tab, params, set } = useParamState('tab', TABS, 'board');
  const tz = me.company.timezone;
  const today = localDate(new Date(), tz);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const q = useEaBoard(ownerId);
  const people = useUsers().data ?? [];
  const [open, setOpen] = useState<{
    id: string;
    ask?: 'schedule' | 'delegate';
    slot?: { date: string; start: string };
  } | null>(params.get('item') ? { id: params.get('item')! } : null);
  const [slot, setSlot] = useState<{ date: string; start: string } | null>(null);
  const [text, setText] = useState('');
  const capture = useWorkMutation(
    (body: { text: string; ownerId?: string }) => api<EaItem>('/api/ea/items', { method: 'POST', body }),
    [['ea']],
    (i) => t('ea.captured', { n: i.number }),
  );
  const board = q.data;
  const item = open && board?.items.find((i) => i.id === open.id);
  const add = () =>
    text.trim() &&
    capture.mutate({ text: text.trim(), ownerId: board?.ownerId }, { onSuccess: () => setText('') });
  const todayCount = board?.items.filter((i) => i.stage === 'SCHEDULED' && i.scheduledDate === today).length;
  const openDelegated = board?.items.filter((i) => i.stage === 'DELEGATED').length;

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.ea')} subtitle={t('navDesc.ea')} />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError || !board ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <KpiTile
              hero
              label={t('ea.tile.toSort')}
              value={board.counts.CAPTURED}
              note={t('ea.tile.toSortNote')}
              icon={Inbox}
            />
            <KpiTile
              label={t('ea.tile.today')}
              value={todayCount ?? 0}
              note={t('ea.tile.todayNote')}
              icon={CalendarClock}
            />
            <KpiTile
              label={t('ea.tile.waiting')}
              value={`${board.counts.WAITING}/${board.settings.waitingCap}`}
              tone={board.counts.WAITING >= board.settings.waitingCap ? 'bad' : undefined}
              note={t('ea.tile.waitingNote')}
              icon={Hourglass}
            />
            <KpiTile
              label={t('ea.tile.delegated')}
              value={openDelegated ?? 0}
              note={t('ea.tile.delegatedNote')}
              icon={Send}
            />
          </div>
          <div className="flex flex-col gap-2 rounded-card border bg-card p-3 sm:flex-row sm:items-center">
            <ClipboardList className="hidden size-5 shrink-0 text-muted-foreground sm:block" />
            <Input
              value={text}
              maxLength={500}
              aria-label={t('ea.capturePh')}
              placeholder={t('ea.capturePh')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <div className="flex gap-2">
              <DictateButton onText={(txt) => setText((v) => (v ? `${v} ${txt}` : txt))} />
              <Button variant="primary" onClick={add} disabled={!text.trim() || capture.isPending}>
                {capture.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('ea.capture')}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <TabStrip
              tabs={TABS}
              active={tab}
              onChange={(k) => set({ tab: k })}
              label={(k) => t(`ea.tab.${k}`)}
            />
            {board.owners.length > 1 && (
              <Select
                aria-label={t('ea.whose')}
                value={board.ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-auto"
              >
                {board.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {tab === 'board' ? (
            <EaBoardView board={board} onOpen={(i, ask) => setOpen({ id: i.id, ask })} />
          ) : (
            <WeekGrid
              board={board}
              today={today}
              onOpen={(i) => setOpen({ id: i.id })}
              onSlot={(date, start) => setSlot({ date, start })}
            />
          )}
          {item && (
            <EaItemDialog
              key={item.id}
              item={item}
              board={board}
              people={people}
              tz={tz}
              today={today}
              initial={open?.ask}
              slot={open?.slot}
              onClose={() => (setOpen(null), set({ item: null }))}
            />
          )}
          {slot && (
            <Dialog
              open
              onOpenChange={(o) => !o && setSlot(null)}
              title={t('ea.bookSlot', { at: `${formatLocalDate(slot.date)} ${slot.start}` })}
              description={t('ea.bookSlotHint')}
            >
              <ul className="space-y-1.5">
                {board.items
                  .filter((i) => i.actions.includes('schedule') && i.stage !== 'SCHEDULED')
                  .map((i) => (
                    <li key={i.id}>
                      <button
                        className="w-full rounded-control border p-2.5 text-left text-sm hover:border-primary"
                        onClick={() => (setOpen({ id: i.id, ask: 'schedule', slot }), setSlot(null))}
                      >
                        <span className="font-mono text-xs text-muted-foreground">#{i.number}</span> {i.text}
                      </button>
                    </li>
                  ))}
                {!board.items.some((i) => i.actions.includes('schedule') && i.stage !== 'SCHEDULED') && (
                  <li className="text-sm text-muted-foreground">{t('ea.nothingToBook')}</li>
                )}
              </ul>
            </Dialog>
          )}
        </>
      )}
    </div>
  );
}
