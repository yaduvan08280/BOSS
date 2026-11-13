import { BedDouble } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Seg } from '@/modules/stock/ui';
import {
  dmy,
  ROOM_TONE,
  send,
  useBoard,
  useHotelMutation,
  useLost,
  useProperty,
  useRoomBlocks,
  type HkBoard,
} from './api';
import { PropertyBar } from './PropertyBar';

type RoomRow = HkBoard['rooms'][number];

/** Housekeeping (phase 17): every room's state, today's cleaning with its checklist, inspection, rooms out of order, lost & found. */
export function HousekeepingPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const p = useProperty();
  const board = useBoard(p.branchId);
  const lost = useLost(p.branchId);
  const blocks = useRoomBlocks(p.branchId);
  const [tab, setTab] = useState<'rooms' | 'lost'>('rooms');
  const [blocking, setBlocking] = useState<RoomRow | null>(null);
  const [item, setItem] = useState('');
  const canWork = hasPermission(me.user.permissions, 'hosp.create');
  const canSup = hasPermission(me.user.permissions, 'hosp.edit');
  const task = useHotelMutation(
    (x: { id: string; body: object }) => send(`/api/hotel/housekeeping/tasks/${x.id}`, x.body),
    undefined,
  );
  const plan = useHotelMutation(
    () => send<{ cleaning: number }>('/api/hotel/housekeeping/plan', { branchId: p.branchId }),
    (r) => t('hotel.hk.planned', { count: r.cleaning }),
  );
  const found = useHotelMutation(
    () => send('/api/hotel/lost-found', { branchId: p.branchId, item }),
    t('hotel.hk.logged'),
  );
  const release = useHotelMutation(
    (id: string) => send(`/api/hotel/room-blocks/${id}/release`),
    t('hotel.hk.released'),
  );
  if (p.loading) return <PageSkeleton />;
  if (!p.list.length)
    return <EmptyState icon={BedDouble} title={t('hotel.noRooms')} body={t('hotel.noRoomsBody')} />;
  const d = board.data;
  return (
    <div>
      <PageHeader
        title={t('hotel.hk.title')}
        subtitle={t('hotel.hk.subtitle')}
        actions={
          canSup && (
            <Button size="sm" disabled={plan.isPending} onClick={() => plan.mutate(undefined)}>
              {t('hotel.hk.plan')}
            </Button>
          )
        }
      />
      <PropertyBar
        list={p.list}
        branchId={p.branchId}
        onChange={p.setBranchId}
        businessDate={d?.businessDate}
      />
      {board.isPending ? (
        <PageSkeleton />
      ) : board.isError || !d ? (
        <ErrorState onRetry={() => void board.refetch()} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile hero label={t('hotel.hk.toClean')} value={String(d.counts.toClean)} />
            <KpiTile label={t('hotel.hk.toInspect')} value={String(d.counts.toInspect)} />
            <KpiTile label={t('hotel.hk.ready')} value={String(d.counts.vacantClean)} />
            <KpiTile label={t('hotel.hk.outOfOrder')} value={String(d.counts.outOfOrder)} />
          </div>
          <Seg
            value={tab}
            onChange={setTab}
            options={[
              { key: 'rooms', label: t('hotel.hk.rooms') },
              { key: 'lost', label: t('hotel.hk.lost') },
            ]}
          />
          {tab === 'rooms' ? (
            <>
              {(blocks.data ?? []).length > 0 && (
                <ul className="mb-3 space-y-1 text-sm">
                  {blocks.data!.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {t('hotel.hk.blockLine', { room: b.room, reason: b.reason, to: dmy(b.to) })}
                        {b.ticket ? ` · #${b.ticket.number}` : ''}
                      </span>
                      {canSup && (
                        <Button size="sm" variant="ghost" onClick={() => release.mutate(b.id)}>
                          {t('hotel.hk.release')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {d.rooms.map((r) => (
                  <li key={r.id}>
                    <Card className="space-y-2 p-3" data-testid={`hk-${r.number}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">
                          {r.number}{' '}
                          <span className="text-xs font-normal text-muted-foreground">{r.type}</span>
                        </span>
                        <StatusChip tone={ROOM_TONE[r.state] ?? 'neutral'}>
                          {t(`hotel.roomState.${r.state}`)}
                        </StatusChip>
                      </div>
                      {r.guest && <div className="text-xs text-muted-foreground">{r.guest}</div>}
                      {r.tasks.map((k) => (
                        <div key={k.id} className="space-y-1 border-t pt-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{t(`hotel.hk.kind.${k.kind}`)}</span>
                            <span className="text-xs text-muted-foreground">
                              {t(`hotel.hk.task.${k.status}`)}
                            </span>
                          </div>
                          {k.status === 'OPEN' &&
                            k.checklist.map((c, i) => (
                              <label key={i} className="flex min-h-9 items-center gap-2">
                                <Checkbox
                                  checked={c.done}
                                  disabled={!canWork}
                                  onChange={(e) =>
                                    task.mutate({
                                      id: k.id,
                                      body: { action: 'tick', index: i, done: e.target.checked },
                                    })
                                  }
                                />
                                {c.text}
                              </label>
                            ))}
                          <div className="flex flex-wrap gap-2">
                            {k.status === 'OPEN' && canWork && (
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={!k.checklist.every((c) => c.done) || task.isPending}
                                onClick={() => task.mutate({ id: k.id, body: { action: 'done' } })}
                              >
                                {t('hotel.hk.done')}
                              </Button>
                            )}
                            {k.status === 'DONE' && canSup && (
                              <>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => task.mutate({ id: k.id, body: { action: 'inspect' } })}
                                >
                                  {t('hotel.hk.inspect')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    task.mutate({
                                      id: k.id,
                                      body: { action: 'redo', note: t('hotel.hk.redoNote') },
                                    })
                                  }
                                >
                                  {t('hotel.hk.redo')}
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                      {canSup && !r.guest && !r.state.startsWith('OUT_') && (
                        <Button size="sm" variant="ghost" onClick={() => setBlocking(r)}>
                          {t('hotel.hk.block')}
                        </Button>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="space-y-3">
              {canWork && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t('hotel.hk.foundItem')} className="w-full sm:w-80">
                    <Input value={item} onChange={(e) => setItem(e.target.value)} />
                  </Field>
                  <Button
                    variant="primary"
                    disabled={!item.trim() || found.isPending}
                    onClick={() => found.mutate(undefined, { onSuccess: () => setItem('') })}
                  >
                    {t('hotel.hk.logFound')}
                  </Button>
                </div>
              )}
              {(lost.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">{t('hotel.hk.noLost')}</p>
              )}
              <ul className="space-y-2">
                {(lost.data ?? []).map((l) => (
                  <li key={l.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <span>
                        {l.item} · {dmy(l.foundOn)}
                        {l.room ? ` · ${l.room}` : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t(`hotel.hk.lostStatus.${l.status}`)}
                        {l.returnedTo ? ` — ${l.returnedTo}` : ''}
                      </span>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {blocking && (
            <BlockDialog room={blocking} today={d.businessDate} onClose={() => setBlocking(null)} />
          )}
        </>
      )}
    </div>
  );
}

/** Take a room off sale: until when, and why (a help ticket is raised when the property has a maintenance person). */
function BlockDialog({ room, today, onClose }: { room: RoomRow; today: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const block = useHotelMutation(
    () => send(`/api/hotel/rooms/${room.id}/block`, { to, reason }),
    t('hotel.hk.blocked', { room: room.number }),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hotel.hk.blockTitle', { room: room.number })}
      footer={
        <Button
          variant="primary"
          disabled={reason.trim().length < 3 || block.isPending}
          onClick={() => block.mutate(undefined, { onSuccess: onClose })}
        >
          {t('hotel.hk.block')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label={t('hotel.hk.until')}>
          <DateInput value={to} min={today} onChange={setTo} aria-label={t('hotel.hk.until')} />
        </Field>
        <Field label={t('hotel.why')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
