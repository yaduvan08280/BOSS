import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { put, usePriceLists, useStock, useStockMutation } from './api';
import { usePlaceName } from './place-name';
import { PlaceSelect } from './ui';

type Route = {
  id: string;
  toBranchId: string;
  category: string;
  fromLocationId: string;
  priceRule: 'COST' | 'COST_PLUS' | 'LIST';
  percent: number | null;
  priceListId: string | null;
};
const RULES = ['COST', 'COST_PLUS', 'LIST'] as const;

/**
 * Supply routes: which store or kitchen supplies a branch — for one category of items or for everything else —
 * and at what price the goods move (cost, cost plus a percent, or a price list).
 */
export function RoutesDialog({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const routes = useQuery({ queryKey: ['stock', 'routes'], queryFn: () => api<Route[]>('/api/ims/routes') });
  const places = (useStock().data?.places ?? []).filter((p) => p.id !== '~transit');
  const lists = usePriceLists();
  const name = usePlaceName();
  const branches = [
    ...new Map(places.filter((p) => p.branchId).map((p) => [p.branchId!, p.branch ?? ''])).entries(),
  ];
  const [d, setD] = useState({
    toBranchId: '',
    category: '',
    fromLocationId: '',
    priceRule: 'COST',
    percent: '',
    priceListId: '',
  });
  const after = { onSettled: () => void routes.refetch() };
  const save = useStockMutation(
    () =>
      put('/api/ims/routes', {
        toBranchId: d.toBranchId,
        category: d.category,
        fromLocationId: d.fromLocationId,
        priceRule: d.priceRule,
        percent: d.priceRule === 'COST_PLUS' ? Number(d.percent) : null,
        priceListId: d.priceRule === 'LIST' ? d.priceListId : null,
      }),
    t('org.saved'),
  );
  const drop = useStockMutation(
    (id: string) => api(`/api/ims/routes/${id}`, { method: 'DELETE' }),
    t('org.deleted'),
  );
  const branchName = (id: string) => branches.find(([b]) => b === id)?.[1] || t('stock.routes.branch');
  const placeOf = (id: string) => {
    const p = places.find((x) => x.id === id);
    return p ? name(p) : t('stock.routes.gone');
  };
  const ready =
    d.toBranchId &&
    (d.priceRule !== 'COST_PLUS' || d.percent !== '') &&
    (d.priceRule !== 'LIST' || d.priceListId);
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.routes.title')}
      description={t('stock.routes.hint')}
    >
      {(routes.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('stock.routes.none')}</p>
      ) : (
        <ul className="divide-y">
          {(routes.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {branchName(r.toBranchId)}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {r.category || t('stock.routes.everything')}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('stock.routes.from', { from: placeOf(r.fromLocationId) })} ·{' '}
                  {r.priceRule === 'COST_PLUS'
                    ? t('stock.routes.plus', { percent: r.percent ?? 0 })
                    : t(`stock.routes.rule.${r.priceRule}`)}
                </div>
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.remove')}
                  disabled={drop.isPending}
                  onClick={() => drop.mutate(r.id, after)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-5 grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2">
          <Field label={t('stock.routes.to')}>
            <Select value={d.toBranchId} onChange={(e) => setD({ ...d, toBranchId: e.target.value })}>
              <option value="">{t('org.choose')}</option>
              {branches.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('stock.routes.fromPlace')}>
            <PlaceSelect
              label={t('stock.routes.fromPlace')}
              value={d.fromLocationId}
              places={places}
              onChange={(fromLocationId) => setD({ ...d, fromLocationId })}
            />
          </Field>
          <Field label={t('stock.routes.category')} hint={t('stock.routes.categoryHint')}>
            <Input value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} />
          </Field>
          <Field label={t('stock.routes.price')}>
            <Select value={d.priceRule} onChange={(e) => setD({ ...d, priceRule: e.target.value })}>
              {RULES.map((k) => (
                <option key={k} value={k}>
                  {t(`stock.routes.rule.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          {d.priceRule === 'COST_PLUS' && (
            <Field label={t('stock.routes.percent')}>
              <Input
                inputMode="decimal"
                value={d.percent}
                onChange={(e) => setD({ ...d, percent: e.target.value })}
              />
            </Field>
          )}
          {d.priceRule === 'LIST' && (
            <Field label={t('stock.routes.list')}>
              <Select value={d.priceListId} onChange={(e) => setD({ ...d, priceListId: e.target.value })}>
                <option value="">{t('org.choose')}</option>
                {(lists.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Button
              variant="primary"
              disabled={!ready || save.isPending}
              onClick={() => save.mutate(undefined, after)}
            >
              {t('stock.routes.save')}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">{t('stock.routes.replace')}</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
