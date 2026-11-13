import { Boxes, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { qty, rupees, useExpiry, useStock, useValuation, type StockRow } from './api';
import { EntryDialog } from './EntryDialog';
import { ItemKeepDialog } from './ItemKeepDialog';
import { usePlaceName } from './place-name';
import { PlaceSelect, Seg } from './ui';

const TABS = ['stock', 'expiry', 'value'] as const;

/** Stock by location (phase 13): what each store, kitchen and bar holds, batch by batch; what expires; what it is worth. */
export function LocationsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof TABS)[number]>('stock');
  const [where, setWhere] = useState('*');
  const [search, setSearch] = useState('');
  const [entry, setEntry] = useState(false);
  const [keep, setKeep] = useState(false);
  const stock = useStock(where === '*' ? undefined : where);
  const all = useStock();
  const places = all.data?.places ?? [];
  const canEnter = hasPermission(me.user.permissions, 'ims.create');
  const rows = (stock.data?.rows ?? []).filter((r) =>
    `${r.name} ${r.code}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div>
      <PageHeader
        title={t('stock.locations.title')}
        subtitle={t('stock.locations.subtitle')}
        actions={
          <>
            {hasPermission(me.user.permissions, 'ims.edit') && (
              <Button variant="secondary" onClick={() => setKeep(true)}>
                {t('stock.keep.title')}
              </Button>
            )}
            {canEnter && (
              <Button variant="primary" onClick={() => setEntry(true)}>
                <Plus /> {t('stock.entry.title')}
              </Button>
            )}
          </>
        }
      />
      <Seg
        value={tab}
        onChange={setTab}
        options={TABS.map((k) => ({ key: k, label: t(`stock.locations.${k}`) }))}
      />
      {tab === 'stock' && (
        <>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[260px_1fr]">
            <PlaceSelect all label={t('stock.location')} value={where} places={places} onChange={setWhere} />
            <Input
              aria-label={t('stock.search')}
              placeholder={t('stock.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {stock.isPending ? (
            <PageSkeleton />
          ) : stock.isError ? (
            <ErrorState onRetry={() => void stock.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title={t('stock.locations.emptyTitle')}
              body={t('stock.locations.emptyBody')}
            />
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={`${r.itemId}|${r.locationId}`}>
                  <Held row={r} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {tab === 'expiry' && <Expiry />}
      {tab === 'value' && <Value />}
      {keep && <ItemKeepDialog onClose={() => setKeep(false)} />}
      {entry && (
        <EntryDialog
          places={places}
          locationId={where === '*' ? (places[0]?.id ?? '') : where}
          onClose={() => setEntry(false)}
        />
      )}
    </div>
  );
}

function Held({ row }: { row: StockRow }) {
  const { t } = useTranslation();
  const name = usePlaceName();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1 basis-48">
          <div className="truncate font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{row.code}</span> ·{' '}
            {name({ id: row.locationId, name: row.location, branch: row.branch })}
          </div>
        </div>
        <div className="text-right">
          <div className="tabular font-semibold">
            {qty(row.qty)} {row.unit}
          </div>
          <div className="tabular text-xs text-muted-foreground">
            {row.whole
              ? t('stock.wholeOpen', {
                  whole: row.whole.whole,
                  unit: row.whole.unit,
                  open: qty(row.whole.open),
                  stockUnit: row.unit,
                })
              : row.secondUnit
                ? `${qty(row.qty2)} ${row.secondUnit}`
                : rupees(row.value)}
          </div>
        </div>
      </button>
      {open && row.batches.length > 0 && (
        <ul className="border-t px-3 py-2 text-sm">
          {row.batches.map((b) => (
            <li key={b.batchId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
              <span className="font-mono">{b.code}</span>
              {b.expiry && (
                <StatusChip tone={b.expired ? 'bad' : (b.daysLeft ?? 99) <= 7 ? 'warn' : 'neutral'}>
                  {b.expired
                    ? t('stock.expired', { date: formatLocalDate(b.expiry) })
                    : t('stock.expires', { date: formatLocalDate(b.expiry) })}
                </StatusChip>
              )}
              {b.attrs && (
                <span className="text-xs text-muted-foreground">
                  {Object.entries(b.attrs)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(' · ')}
                </span>
              )}
              <span className="tabular ml-auto">
                {qty(b.qty)} {row.unit}
                {row.secondUnit && b.qty2 ? ` · ${qty(b.qty2)} ${row.secondUnit}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && row.batches.length === 0 && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t('stock.noBatches')}</p>
      )}
    </Card>
  );
}

function Expiry() {
  const { t } = useTranslation();
  const q = useExpiry();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data.length)
    return <EmptyState icon={Boxes} title={t('stock.expiryNone')} body={t('stock.expiryNoneBody')} />;
  return (
    <ul className="space-y-2">
      {q.data.map((b) => (
        <li key={`${b.batchId}|${b.location}`}>
          <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
            <div className="min-w-0 flex-1 basis-48">
              <div className="font-medium">{b.item}</div>
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">{b.batch}</span> · {b.location}
              </div>
            </div>
            <StatusChip tone={b.expired ? 'bad' : 'warn'}>
              {b.expired
                ? t('stock.expired', { date: formatLocalDate(b.expiry!) })
                : t('stock.expires', { date: formatLocalDate(b.expiry!) })}
            </StatusChip>
            <span className="tabular font-semibold">
              {qty(b.qty)} {b.unit}
            </span>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Value() {
  const { t } = useTranslation();
  const q = useValuation();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          hero
          label={t('stock.value.total')}
          value={rupees(q.data.total)}
          note={t(`stock.value.${q.data.method}`)}
        />
      </div>
      <ul className="space-y-2">
        {q.data.locations.map((l) => (
          <li key={l.locationId || 'main'}>
            <Card className="flex items-center justify-between gap-3 p-3">
              <div>
                <div className="font-medium">{l.locationId === '' ? t('stock.mainStore') : l.location}</div>
                <div className="text-xs text-muted-foreground">
                  {l.branch ? `${l.branch} · ` : ''}
                  {t('stock.value.items', { count: l.items })}
                </div>
              </div>
              <span className="tabular font-semibold">{rupees(l.value)}</span>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
