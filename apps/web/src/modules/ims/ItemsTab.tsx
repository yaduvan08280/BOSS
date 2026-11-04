import { FileUp, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatINR } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Confirm, Dialog } from '@/components/ui/dialog';
import { Field, Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { imsApi, qty, useImsMutation, useItems, type ItemRow } from './api';
import { ImportItems } from './ImportItems';

/** Item master (§10.3): code, name, unit, category, location, lead time, safety factor, MAX, min, rate, vendor. */
export function ItemsTab({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const q = useItems(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ItemRow | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<ItemRow | null>(null);
  const remove = useImsMutation(
    (id: string) => imsApi.deleteItem(id),
    () => t('ims.i.removed'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const rows = q.data.items.filter(
    (i) => !search.trim() || matchScore(search, [i.code, i.name, i.category, i.vendor].join(' ')) > 0,
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={t('ims.s.search')}
          placeholder={t('ims.s.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 sm:max-w-72"
        />
        {canEdit && (
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <FileUp /> {t('ims.i.import')}
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus /> {t('ims.i.add')}
            </Button>
          </>
        )}
      </div>
      {!rows.length && (
        <p className="text-sm text-muted-foreground">
          {q.data.items.length ? t('common.noMatch') : t('ims.s.emptyBody')}
        </p>
      )}
      <div className="overflow-x-auto rounded-card border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              {['code', 'name', 'unit', 'lead', 'sf', 'max', 'min', 'rate', 'vendor'].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {t(`ims.i.col.${h}`)}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className={`border-t ${i.active ? '' : 'text-muted-foreground'}`}>
                <td className="px-3 py-2 font-mono text-xs">{i.code}</td>
                <td className="px-3 py-2">
                  {i.name}
                  {!i.active && ` · ${t('ims.i.off')}`}
                </td>
                <td className="px-3 py-2">{i.unit}</td>
                <td className="px-3 py-2 tabular-nums">{t('ims.i.days', { count: i.leadTimeDays })}</td>
                <td className="px-3 py-2 tabular-nums">{i.safetyFactor}</td>
                <td className="px-3 py-2 tabular-nums">{i.maxQty === null ? '—' : qty(i.maxQty)}</td>
                <td className="px-3 py-2 tabular-nums">{i.minQty === null ? '—' : qty(i.minQty)}</td>
                <td className="px-3 py-2 tabular-nums">{formatINR(i.ratePaise)}</td>
                <td className="px-3 py-2">{i.vendor ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right">
                  {canEdit && (
                    <>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('common.edit')}
                        onClick={() => setEditing(i)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('common.delete')}
                        onClick={() => setRemoving(i)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <ItemDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ImportItems open={importing} onClose={() => setImporting(false)} />
      <Confirm
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('ims.i.removeTitle', { name: removing?.name ?? '' })}
        body={t('ims.i.removeBody')}
        confirm={t('common.delete')}
        danger
        onConfirm={() => removing && remove.mutate(removing.id, { onSettled: () => setRemoving(null) })}
      />
    </div>
  );
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));

function ItemDialog({ item, onClose }: { item: ItemRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({
    code: item?.code ?? '',
    name: item?.name ?? '',
    unit: item?.unit ?? 'pcs',
    category: item?.category ?? '',
    location: item?.location ?? '',
    leadTimeDays: String(item?.leadTimeDays ?? 7),
    safetyFactor: String(item?.safetyFactor ?? 1.5),
    maxQty: item?.maxQty === null || item?.maxQty === undefined ? '' : String(item.maxQty),
    minQty: item?.minQty === null || item?.minQty === undefined ? '' : String(item.minQty),
    rate: item ? String(Number(item.ratePaise) / 100) : '',
    vendor: item?.vendor ?? '',
    openingQty: '',
    active: item?.active ?? true,
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  const numbers = [v.leadTimeDays, v.safetyFactor, v.maxQty, v.minQty, v.rate, v.openingQty].map(num);
  const ok =
    v.code.trim() &&
    v.name.trim().length >= 2 &&
    numbers.every((x) => x === null || (Number.isFinite(x) && x >= 0));
  const save = useImsMutation(
    () =>
      imsApi.saveItem(
        {
          code: v.code.trim(),
          name: v.name.trim(),
          unit: v.unit.trim() || 'pcs',
          category: v.category.trim() || null,
          location: v.location.trim() || null,
          leadTimeDays: Math.round(num(v.leadTimeDays) ?? 7),
          safetyFactor: num(v.safetyFactor) ?? 1.5,
          maxQty: num(v.maxQty),
          minQty: num(v.minQty),
          ratePaise: Math.round((num(v.rate) ?? 0) * 100),
          vendor: v.vendor.trim() || null,
          active: v.active,
          ...(item ? {} : { openingQty: num(v.openingQty) ?? 0 }),
        },
        item?.id,
      ),
    () => t('ims.i.saved'),
  );
  const field = (k: keyof typeof v, label: string, hint?: string, mode?: 'decimal') => (
    <Field label={label} hint={hint}>
      <Input value={String(v[k])} onChange={set(k)} inputMode={mode} />
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={item ? item.name : t('ims.i.add')}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!ok || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('code', t('ims.i.col.code'))}
        {field('name', t('ims.i.col.name'))}
        {field('unit', t('ims.i.col.unit'), t('ims.i.unitHint'))}
        {field('category', t('ims.i.category'))}
        {field('location', t('ims.i.location'))}
        {field('vendor', t('ims.i.col.vendor'))}
        {field('leadTimeDays', t('ims.i.leadDays'), undefined, 'decimal')}
        {field('safetyFactor', t('ims.i.col.sf'), t('ims.i.sfHint'), 'decimal')}
        {field('maxQty', t('ims.i.col.max'), t('ims.i.maxHint'), 'decimal')}
        {field('minQty', t('ims.i.col.min'), t('ims.i.minHint'), 'decimal')}
        {field('rate', t('ims.i.rate'), undefined, 'decimal')}
        {!item && field('openingQty', t('ims.i.opening'), undefined, 'decimal')}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Switch checked={v.active} onCheckedChange={(active) => setV({ ...v, active })} />{' '}
          {t('ims.i.active')}
        </label>
      </div>
    </Dialog>
  );
}
