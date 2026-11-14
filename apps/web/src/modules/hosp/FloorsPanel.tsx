import { LayoutGrid, Pencil, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { TABLE_SHAPES } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { send, useHospMutation, useOutlets, usePlan, type Table } from './api';
import { useOutletChoice } from './outletChoice';

const COLS = 24;

/** Floors and tables: the plan of an outlet. Tables are added one by one or many at once and dragged to their place. */
export function FloorsPanel() {
  const { t } = useTranslation();
  const outlets = useOutlets();
  // Start at the outlet the address names (a link from the POS), else the one picked last, else a dining room.
  const [params] = useSearchParams();
  const [chosen, setOutletId] = useOutletChoice(outlets.data);
  const linked = params.get('outlet');
  const [fromLink, setFromLink] = useState(Boolean(linked));
  const current = fromLink && linked && outlets.data?.some((o) => o.id === linked) ? linked : chosen;
  const plan = usePlan(current);
  const [floorId, setFloorId] = useState('');
  const [edit, setEdit] = useState<Partial<Table> | null>(null);
  const [bulk, setBulk] = useState(false);
  const [floorEdit, setFloorEdit] = useState(false);
  const [name, setName] = useState('');
  const addFloor = useHospMutation(
    () => send('POST', '/api/hosp/floors', { outletId: current, name }),
    t('org.saved'),
  );
  if (outlets.isPending) return <PageSkeleton />;
  if (outlets.isError) return <ErrorState onRetry={() => void outlets.refetch()} error={outlets.error} />;
  if (!outlets.data.length)
    return (
      <EmptyState icon={LayoutGrid} title={t('hosp.floor.noOutlet')} body={t('hosp.floor.noOutletBody')} />
    );
  const floors = plan.data ?? [];
  const floor = floors.find((f) => f.id === floorId) ?? floors[0];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[240px_1fr_auto]">
        <Select
          aria-label={t('hosp.outlet.one')}
          value={current}
          onChange={(e) => {
            setFromLink(false);
            setOutletId(e.target.value);
            setFloorId('');
          }}
        >
          {outlets.data.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Input
          aria-label={t('hosp.floor.name')}
          placeholder={t('hosp.floor.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!name.trim() || addFloor.isPending}
          onClick={() => addFloor.mutate(undefined, { onSuccess: () => setName('') })}
        >
          <Plus /> {t('hosp.floor.add')}
        </Button>
      </div>
      {plan.isPending ? (
        <PageSkeleton />
      ) : !floor ? (
        <EmptyState icon={LayoutGrid} title={t('hosp.floor.emptyTitle')} body={t('hosp.floor.emptyBody')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {floors.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={f.id === floor.id}
                onClick={() => setFloorId(f.id)}
                className={cn(
                  'h-9 rounded-pill border px-3 text-sm font-medium',
                  f.id === floor.id
                    ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                    : 'bg-card text-muted-foreground',
                )}
              >
                {f.name} · {f.tables.length}
              </button>
            ))}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('hosp.floor.edit', { name: floor.name })}
              title={t('hosp.floor.edit', { name: floor.name })}
              onClick={() => setFloorEdit(true)}
            >
              <Pencil />
            </Button>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setBulk(true)}>
                {t('hosp.table.many')}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setEdit({})}>
                <Plus /> {t('hosp.table.add')}
              </Button>
            </span>
          </div>
          <Plan tables={floor.tables} onOpen={setEdit} />
          <p className="text-xs text-muted-foreground">{t('hosp.table.dragHint')}</p>
        </>
      )}
      {edit && floor && <TableDialog floorId={floor.id} table={edit} onClose={() => setEdit(null)} />}
      {bulk && floor && <BulkDialog floorId={floor.id} onClose={() => setBulk(false)} />}
      {floorEdit && floor && (
        <FloorDialog
          outletId={current}
          floor={floor}
          onClose={(gone) => {
            setFloorEdit(false);
            if (gone) setFloorId('');
          }}
        />
      )}
    </div>
  );
}

/** The plan: a 24-column grid; a table is two cells square. Drag to move (saved on release), tap to open. */
function Plan({ tables, onOpen }: { tables: Table[]; onOpen: (t: Table) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const move = useHospMutation((m: { id: string; x: number; y: number }) =>
    send('POST', '/api/hosp/tables/move', { moves: [m] }),
  );
  const rows = Math.max(12, ...tables.map((t) => t.y + 4));
  const cell = () => (box.current ? box.current.clientWidth / COLS : 16);
  const spot = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(COLS - 2, Math.round((e.clientX - r.left) / cell() - 1))),
      y: Math.max(0, Math.round((e.clientY - r.top) / cell() - 1)),
    };
  };
  return (
    <div className="overflow-x-auto">
      <div
        ref={box}
        className="relative touch-none overflow-hidden rounded-card border bg-muted/40"
        style={{ aspectRatio: `${COLS} / ${rows}`, minWidth: 640 }}
      >
        {tables.map((t) => {
          const at = drag?.id === t.id ? drag : t;
          return (
            <button
              key={t.id}
              type="button"
              aria-label={`${t.name}, ${t.seats}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({ id: t.id, x: t.x, y: t.y, moved: false });
              }}
              onPointerMove={(e) => {
                if (drag?.id !== t.id) return;
                const s = spot(e);
                if (s.x !== drag.x || s.y !== drag.y) setDrag({ ...drag, ...s, moved: true });
              }}
              onPointerCancel={() => setDrag(null)}
              onPointerUp={() => {
                if (drag?.id !== t.id) return;
                if (drag.moved) move.mutate({ id: t.id, x: drag.x, y: drag.y });
                else onOpen(t);
                setDrag(null);
              }}
              className={cn(
                // touch-none: on a phone or tablet the finger moves the table instead of scrolling the page.
                'absolute flex touch-none flex-col items-center justify-center border bg-card text-[11px] font-medium leading-tight shadow-sm',
                t.shape === 'ROUND' ? 'rounded-full' : 'rounded-control',
                drag?.id === t.id && 'ring-2 ring-ring',
              )}
              style={{
                left: `${(at.x / COLS) * 100}%`,
                top: `${(at.y / rows) * 100}%`,
                width: `${((t.shape === 'RECT' ? 3 : 2) / COLS) * 100}%`,
                height: `${(2 / rows) * 100}%`,
              }}
            >
              <span className="truncate">{t.name}</span>
              <span className="text-muted-foreground">{t.seats}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Rename a floor, or delete it once its tables are moved or deleted. */
function FloorDialog({
  outletId,
  floor,
  onClose,
}: {
  outletId: string;
  floor: { id: string; name: string; tables: Table[] };
  onClose: (gone?: boolean) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(floor.name);
  const save = useHospMutation(
    () => send('PUT', `/api/hosp/floors/${floor.id}`, { outletId, name }),
    t('org.saved'),
  );
  const drop = useHospMutation(() => send('DELETE', `/api/hosp/floors/${floor.id}`), t('org.deleted'));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hosp.floor.edit', { name: floor.name })}
      description={
        floor.tables.length ? t('hosp.floor.hasTables', { count: floor.tables.length }) : undefined
      }
      footer={
        <>
          <Button
            variant="ghost"
            disabled={drop.isPending || floor.tables.length > 0}
            onClick={() => drop.mutate(undefined, { onSuccess: () => onClose(true) })}
          >
            {t('org.delete')}
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: () => onClose() })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('hosp.floor.label')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}

function TableDialog({
  floorId,
  table,
  onClose,
}: {
  floorId: string;
  table: Partial<Table>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState({
    name: table.name ?? '',
    seats: String(table.seats ?? 4),
    shape: table.shape ?? 'SQUARE',
    section: table.section ?? '',
    combinable: table.combinable ?? false,
  });
  const body = {
    floorId,
    name: d.name,
    seats: Number(d.seats) || 1,
    shape: d.shape,
    section: d.section || null,
    combinable: d.combinable,
    x: table.x ?? 0,
    y: table.y ?? 0,
    stewardIds: table.stewardIds ?? [],
  };
  const save = useHospMutation(
    () =>
      table.id ? send('PUT', `/api/hosp/tables/${table.id}`, body) : send('POST', '/api/hosp/tables', body),
    t('org.saved'),
  );
  const drop = useHospMutation(() => send('DELETE', `/api/hosp/tables/${table.id}`), t('org.deleted'));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={table.id ? t('hosp.table.one', { name: table.name }) : t('hosp.table.add')}
      footer={
        <>
          {table.id && (
            <Button
              variant="ghost"
              disabled={drop.isPending}
              onClick={() => drop.mutate(undefined, { onSuccess: onClose })}
            >
              {t('org.delete')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!d.name.trim() || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('hosp.table.name')}>
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('hosp.table.seats')}>
          <Input
            inputMode="numeric"
            value={d.seats}
            onChange={(e) => setD({ ...d, seats: e.target.value })}
          />
        </Field>
        <Field label={t('hosp.table.shape')}>
          <Select value={d.shape} onChange={(e) => setD({ ...d, shape: e.target.value })}>
            {TABLE_SHAPES.map((s) => (
              <option key={s} value={s}>
                {t(`hosp.table.shapes.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hosp.table.section')}>
          <Input value={d.section} onChange={(e) => setD({ ...d, section: e.target.value })} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <Checkbox checked={d.combinable} onChange={(e) => setD({ ...d, combinable: e.target.checked })} />
          {t('hosp.table.combinable')}
        </label>
      </div>
    </Dialog>
  );
}

function BulkDialog({ floorId, onClose }: { floorId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState({ count: '10', prefix: 'T', from: '1', seats: '4' });
  const save = useHospMutation(
    () =>
      send<{ added: number }>('POST', '/api/hosp/tables/bulk', {
        floorId,
        count: Number(d.count),
        prefix: d.prefix,
        from: Number(d.from) || 1,
        seats: Number(d.seats) || 4,
      }),
    (r) => t('hosp.table.added', { count: r.added }),
  );
  const field = (k: keyof typeof d, label: string, numeric = true) => (
    <Field label={label}>
      <Input
        inputMode={numeric ? 'numeric' : undefined}
        value={d[k]}
        onChange={(e) => setD({ ...d, [k]: e.target.value })}
      />
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hosp.table.many')}
      footer={
        <Button
          variant="primary"
          disabled={!(Number(d.count) > 0) || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('hosp.table.addThem')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {field('count', t('hosp.table.howMany'))}
        {field('seats', t('hosp.table.seats'))}
        {field('prefix', t('hosp.table.prefix'), false)}
        {field('from', t('hosp.table.from'))}
      </div>
    </Dialog>
  );
}
