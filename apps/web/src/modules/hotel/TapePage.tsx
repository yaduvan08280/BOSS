import { BedDouble } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { ROOM_TONE, send, useHotelMutation, useProperty, useTape } from './api';
import { PropertyBar } from './PropertyBar';
import { StayDialog } from './StayDialog';

const CELL: Record<string, string> = {
  BOOKED: 'bg-status-info-bg text-status-info-fg',
  CHECKED_IN: 'bg-status-ok-bg text-status-ok-fg',
  CHECKED_OUT: 'bg-status-neutral-bg text-status-neutral-fg',
};

/** The room calendar (phase 17): rooms down, days across; a stay in its cells; bookings still waiting for a room. */
export function TapePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const p = useProperty();
  const tape = useTape(p.branchId, 14);
  const [openId, setOpenId] = useState<string | null>(null);
  const canDesk = hasPermission(me.user.permissions, 'hosp.create');
  const assign = useHotelMutation(
    (x: { stayId: string; roomId: string }) =>
      send<{ room: string }>(`/api/hotel/stays/${x.stayId}/room`, { roomId: x.roomId }),
    (r) => t('hotel.tape.assigned', { room: r.room }),
  );
  if (p.loading) return <PageSkeleton />;
  if (!p.list.length)
    return <EmptyState icon={BedDouble} title={t('hotel.noRooms')} body={t('hotel.noRoomsBody')} />;
  const d = tape.data;
  return (
    <div>
      <PageHeader title={t('hotel.tape.title')} subtitle={t('hotel.tape.subtitle')} />
      <PropertyBar
        list={p.list}
        branchId={p.branchId}
        onChange={p.setBranchId}
        businessDate={d?.businessDate}
      />
      {tape.isPending ? (
        <PageSkeleton />
      ) : tape.isError || !d ? (
        <ErrorState onRetry={() => void tape.refetch()} error={tape.error} />
      ) : (
        <div className="space-y-4">
          {d.unassigned.length > 0 && (
            <Card className="space-y-2 p-3">
              <h2 className="text-sm font-semibold">
                {t('hotel.tape.unassigned', { count: d.unassigned.length })}
              </h2>
              <ul className="space-y-2">
                {d.unassigned.map((id) => {
                  const s = d.stays.find((x) => x.id === id)!;
                  return (
                    <li key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        {s.guest?.name} · {s.roomType} · {s.nights} {t('hotel.nightsShort')}
                      </span>
                      {canDesk && (
                        <div className="w-40">
                          <Select
                            aria-label={t('hotel.tape.roomFor', { name: s.guest?.name ?? '' })}
                            value=""
                            onChange={(e) =>
                              e.target.value && assign.mutate({ stayId: id, roomId: e.target.value })
                            }
                          >
                            <option value="">{t('hotel.chooseRoom')}</option>
                            {d.rooms
                              .filter((r) => r.typeId === s.roomTypeId)
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.number}
                                </option>
                              ))}
                          </Select>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          {/* The chart scrolls inside itself, so the page never scrolls sideways on a phone. */}
          <div className="overflow-x-auto rounded-card border bg-card">
            <table className="w-max min-w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card p-2 text-left">{t('hotel.room')}</th>
                  {d.days.map((day) => (
                    <th
                      key={day}
                      className={cn('w-20 p-2 font-medium', day === d.businessDate && 'bg-accent-soft')}
                    >
                      {day.slice(8)}/{day.slice(5, 7)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rooms.map((r) => (
                  <tr key={r.id} className="border-t">
                    <th scope="row" className="sticky left-0 z-10 bg-card p-2 text-left">
                      <div className="font-semibold">{r.number}</div>
                      <StatusChip tone={ROOM_TONE[r.state] ?? 'neutral'}>
                        {t(`hotel.roomState.${r.state}`)}
                      </StatusChip>
                    </th>
                    {d.days.map((day) => {
                      const cell = r.cells.find((c) => c.day === day);
                      const stay = cell?.stayId ? d.stays.find((s) => s.id === cell.stayId) : null;
                      return (
                        <td key={day} className="h-12 w-20 border-l p-0.5">
                          {stay ? (
                            <button
                              type="button"
                              onClick={() => setOpenId(stay.id)}
                              className={cn('size-full truncate rounded px-1 text-left', CELL[stay.status])}
                              title={`${stay.guest?.name} · ${stay.number}`}
                            >
                              {stay.guest?.name}
                            </button>
                          ) : cell?.block ? (
                            <div
                              className="grid size-full place-items-center rounded bg-status-bad-bg text-status-bad-fg"
                              title={cell.block}
                            >
                              {t('hotel.tape.blocked')}
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {openId && (
        <StayDialog
          id={openId}
          branchId={p.branchId}
          rooms={p.rooms}
          canDesk={canDesk}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
