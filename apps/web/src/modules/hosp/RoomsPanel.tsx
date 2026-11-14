import { BedDouble, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { rupees } from '@/modules/stock/api';
import { useBranches } from '@/modules/system/api';
import { send, useHospMutation, useRooms, type Room, type RoomType } from './api';

/** Room types (occupancy, beds, amenities, the declared tariff) and the rooms of each, by number. */
export function RoomsPanel() {
  const { t } = useTranslation();
  const q = useRooms();
  const [edit, setEdit] = useState<Partial<RoomType> | null>(null);
  const [add, setAdd] = useState<RoomType | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEdit({})}>
          <Plus /> {t('hosp.room.addType')}
        </Button>
      </div>
      {q.data.types.length === 0 ? (
        <EmptyState icon={BedDouble} title={t('hosp.room.emptyTitle')} body={t('hosp.room.emptyBody')} />
      ) : (
        <ul className="space-y-2">
          {q.data.types.map((ty) => (
            <li key={ty.id}>
              <Card className="p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 basis-48 text-left"
                    onClick={() => setEdit(ty)}
                  >
                    <div className="truncate font-medium">
                      {ty.name} <span className="font-mono text-xs text-muted-foreground">{ty.code}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('hosp.room.guests', { usual: ty.occupancy, most: ty.maxOccupancy })}
                      {ty.beds && ` · ${ty.beds}`}
                      {ty.tariff !== null && ` · ${rupees(ty.tariff)}`}
                    </div>
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {t('hosp.room.count', { count: ty.rooms })}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setAdd(ty)}>
                    <Plus /> {t('hosp.room.addRooms')}
                  </Button>
                </div>
                {ty.rooms > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {q.data.rooms
                      .filter((r) => r.typeId === ty.id)
                      .map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRoom(r)}
                          className="h-8 min-w-11 rounded-pill border px-2.5 font-mono text-xs hover:bg-muted"
                          aria-label={t('hosp.room.editOne', { number: r.number })}
                          title={
                            r.connectsTo.length
                              ? t('hosp.room.connects', { rooms: r.connectsTo.join(', ') })
                              : t('hosp.room.editOne', { number: r.number })
                          }
                        >
                          {r.number}
                          {r.connectsTo.length > 0 && ' ⇄'}
                        </button>
                      ))}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {edit && <TypeDialog type={edit} onClose={() => setEdit(null)} />}
      {add && <RoomsDialog type={add} onClose={() => setAdd(null)} />}
      {room && (
        <RoomDialog
          room={room}
          types={q.data.types.filter((x) => x.branchId === room.branchId)}
          onClose={() => setRoom(null)}
        />
      )}
    </div>
  );
}

function TypeDialog({ type, onClose }: { type: Partial<RoomType>; onClose: () => void }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const [d, setD] = useState({
    branchId: type.branchId ?? '',
    name: type.name ?? '',
    code: type.code ?? '',
    occupancy: String(type.occupancy ?? 2),
    maxOccupancy: String(type.maxOccupancy ?? 3),
    beds: type.beds ?? '',
    amenities: (type.amenities ?? []).join(', '),
    tariff: type.tariff === null || type.tariff === undefined ? '' : String(type.tariff / 100),
  });
  const branchId = d.branchId || branches.data?.[0]?.id || '';
  const body = {
    branchId,
    name: d.name,
    code: d.code,
    occupancy: Number(d.occupancy) || 1,
    maxOccupancy: Number(d.maxOccupancy) || 1,
    beds: d.beds || null,
    amenities: d.amenities
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tariff: d.tariff === '' ? null : Math.round(Number(d.tariff) * 100),
    taxCode: type.taxCode ?? null,
  };
  const save = useHospMutation(
    () =>
      type.id
        ? send('PUT', `/api/hosp/room-types/${type.id}`, body)
        : send('POST', '/api/hosp/room-types', body),
    t('org.saved'),
  );
  const drop = useHospMutation(() => send('DELETE', `/api/hosp/room-types/${type.id}`), t('org.deleted'));

  const text = (
    k: keyof typeof d,
    label: string,
    more: { hint?: string; num?: boolean; wide?: boolean } = {},
  ) => (
    <Field label={label} hint={more.hint} className={more.wide ? 'col-span-2' : undefined}>
      <Input
        inputMode={more.num ? 'decimal' : undefined}
        value={d[k]}
        onChange={(e) => setD({ ...d, [k]: e.target.value })}
      />
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={type.id ? type.name : t('hosp.room.addType')}
      footer={
        <>
          {type.id && (
            <Button
              variant="ghost"
              disabled={drop.isPending}
              title={type.rooms ? t('hosp.room.typeHasRooms') : undefined}
              onClick={() => drop.mutate(undefined, { onSuccess: onClose })}
            >
              {t('org.delete')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!d.name.trim() || !d.code.trim() || !branchId || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('hosp.outlet.branch')} className="col-span-2">
          <Select
            value={branchId}
            onChange={(e) => setD({ ...d, branchId: e.target.value })}
            disabled={Boolean(type.id)}
          >
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        {text('name', t('org.name'))}
        {text('code', t('hosp.room.code'))}
        {text('occupancy', t('hosp.room.occupancy'), { num: true })}
        {text('maxOccupancy', t('hosp.room.maxOccupancy'), { num: true })}
        {text('beds', t('hosp.room.beds'))}
        {text('tariff', t('hosp.room.tariff'), { num: true, hint: t('hosp.room.tariffHint') })}
        {text('amenities', t('hosp.room.amenities'), { hint: t('hosp.room.amenitiesHint'), wide: true })}
      </div>
    </Dialog>
  );
}

function RoomsDialog({ type, onClose }: { type: RoomType; onClose: () => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState({ from: '', to: '', floor: '' });
  const save = useHospMutation(
    () =>
      send<{ added: number }>('POST', '/api/hosp/rooms/bulk', {
        typeId: type.id,
        from: Number(d.from),
        to: Number(d.to || d.from),
        floor: d.floor || null,
      }),
    (r) => t('hosp.room.added', { count: r.added }),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hosp.room.addRoomsTo', { name: type.name })}
      footer={
        <Button
          variant="primary"
          disabled={!(Number(d.from) > 0) || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('hosp.room.addRooms')}
        </Button>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('hosp.room.from')}>
          <Input
            inputMode="numeric"
            value={d.from}
            onChange={(e) => setD({ ...d, from: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label={t('hosp.room.to')}>
          <Input inputMode="numeric" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} />
        </Field>
        <Field label={t('hosp.room.floor')}>
          <Input value={d.floor} onChange={(e) => setD({ ...d, floor: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

/** One room: its number, category, floor, features and connecting doors — or delete it. */
function RoomDialog({ room, types, onClose }: { room: Room; types: RoomType[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState({
    number: room.number,
    typeId: room.typeId,
    floor: room.floor ?? '',
    features: room.features.join(', '),
    connectsTo: room.connectsTo.join(', '),
  });
  const list = (v: string) =>
    v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const save = useHospMutation(
    () =>
      send('PUT', `/api/hosp/rooms/${room.id}`, {
        typeId: d.typeId,
        number: d.number.trim(),
        floor: d.floor.trim() || null,
        features: list(d.features),
        connectsTo: list(d.connectsTo),
      }),
    t('org.saved'),
  );
  const drop = useHospMutation(() => send('DELETE', `/api/hosp/rooms/${room.id}`), t('org.deleted'));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hosp.room.editOne', { number: room.number })}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={drop.isPending}
            onClick={() => drop.mutate(undefined, { onSuccess: onClose })}
          >
            {t('org.delete')}
          </Button>
          <Button
            variant="primary"
            disabled={!d.number.trim() || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('hosp.room.number')}>
          <Input value={d.number} onChange={(e) => setD({ ...d, number: e.target.value })} autoFocus />
        </Field>
        <Field label={t('hosp.room.floor')}>
          <Input value={d.floor} onChange={(e) => setD({ ...d, floor: e.target.value })} />
        </Field>
        <Field label={t('hosp.room.type')} className="col-span-2">
          <Select value={d.typeId} onChange={(e) => setD({ ...d, typeId: e.target.value })}>
            {types.map((ty) => (
              <option key={ty.id} value={ty.id}>
                {ty.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hosp.room.features')} className="col-span-2" hint={t('hosp.room.featuresHint')}>
          <Input value={d.features} onChange={(e) => setD({ ...d, features: e.target.value })} />
        </Field>
        <Field label={t('hosp.room.connectsTo')} className="col-span-2" hint={t('hosp.room.connectsHint')}>
          <Input value={d.connectsTo} onChange={(e) => setD({ ...d, connectsTo: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
