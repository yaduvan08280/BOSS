import { ListChecks, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { put, qty, useItems, usePar, useStockMutation, type Place } from './api';
import { ItemSelect, PlaceSelect } from './ui';

/**
 * Par levels of one location: what it should hold of each item, what is there, what is coming, and what to ask
 * for — from the supplying store (an indent) or, with no supply route, from the vendor (a purchase).
 */
export function ParTab({ places, canEdit }: { places: Place[]; canEdit: boolean }) {
  const { t } = useTranslation();
  const [where, setWhere] = useState(places.find((p) => p.id !== '~transit')?.id ?? '');
  const par = usePar(where);
  const items = useItems();
  const [add, setAdd] = useState({ itemId: '', par: '', min: '' });
  const [typed, setTyped] = useState<Record<string, string>>({});
  const save = useStockMutation(
    (levels: { itemId: string; par: number; min?: number | null }[]) =>
      put('/api/ims/par', { locationId: where, levels }),
    t('org.saved'),
  );
  const rows = par.data?.rows ?? [];
  const listed = new Set(rows.map((r) => r.itemId));
  const short = rows.filter((r) => r.short);
  return (
    <div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[260px_minmax(0,1fr)]">
        <PlaceSelect label={t('stock.location')} value={where} places={places} onChange={setWhere} />
        <p className="self-center text-sm text-muted-foreground">
          {rows.length
            ? t('stock.par.summary', { count: short.length, of: rows.length })
            : t('stock.par.hint')}
        </p>
      </div>
      {canEdit && (
        <Card className="mb-3 grid grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto]">
          <ItemSelect
            label={t('stock.par.item')}
            value={add.itemId}
            items={(items.data?.items ?? []).filter((i) => !listed.has(i.id))}
            onChange={(itemId) => setAdd({ ...add, itemId })}
          />
          <Input
            aria-label={t('stock.par.level')}
            placeholder={t('stock.par.level')}
            inputMode="decimal"
            value={add.par}
            onChange={(e) => setAdd({ ...add, par: e.target.value })}
          />
          <Input
            aria-label={t('stock.par.min')}
            placeholder={t('stock.par.min')}
            inputMode="decimal"
            value={add.min}
            onChange={(e) => setAdd({ ...add, min: e.target.value })}
          />
          <Button
            variant="primary"
            disabled={!add.itemId || !(Number(add.par) > 0) || save.isPending}
            onClick={() =>
              save.mutate(
                [{ itemId: add.itemId, par: Number(add.par), min: add.min === '' ? null : Number(add.min) }],
                { onSuccess: () => setAdd({ itemId: '', par: '', min: '' }) },
              )
            }
          >
            <Plus /> {t('stock.par.add')}
          </Button>
        </Card>
      )}
      {par.isPending ? (
        <PageSkeleton />
      ) : par.isError ? (
        <ErrorState onRetry={() => void par.refetch()} error={par.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ListChecks} title={t('stock.par.emptyTitle')} body={t('stock.par.hint')} />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.itemId}>
              <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                <div className="min-w-0 flex-1 basis-52">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{r.code}</span> ·{' '}
                    {t('stock.par.has', { stock: qty(r.stock), unit: r.unit })}
                    {r.coming > 0 && ` · ${t('stock.par.coming', { qty: qty(r.coming) })}`}
                    {r.min !== null && ` · ${t('stock.par.minIs', { qty: qty(r.min) })}`}
                  </div>
                </div>
                {r.short ? (
                  <StatusChip tone="bad">
                    {`${t('stock.par.ask', { qty: qty(r.ask), unit: r.unit })} · ${
                      r.source.type === 'indent'
                        ? t('stock.par.fromStore', { from: r.source.from ?? '' })
                        : r.source.vendor
                          ? t('stock.par.fromVendor', { vendor: r.source.vendor })
                          : t('stock.par.buy')
                    }`}
                  </StatusChip>
                ) : (
                  <StatusChip tone="ok">{t('stock.par.enough')}</StatusChip>
                )}
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={t('stock.par.levelOf', { name: r.name })}
                      inputMode="decimal"
                      className="w-24"
                      value={typed[r.itemId] ?? qty(r.par)}
                      onChange={(e) => setTyped({ ...typed, [r.itemId]: e.target.value })}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        typed[r.itemId] === undefined || Number(typed[r.itemId]) === r.par || save.isPending
                      }
                      onClick={() =>
                        save.mutate([{ itemId: r.itemId, par: Number(typed[r.itemId]) || 0, min: r.min }], {
                          onSuccess: () => setTyped(({ [r.itemId]: _, ...rest }) => rest),
                        })
                      }
                    >
                      {t('common.save')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
