import { Plus, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToday } from '@/modules/money/api';
import {
  post,
  put,
  rupees,
  toPaise,
  useBoard,
  useItems,
  usePriceLists,
  useStockMutation,
  type PriceList,
} from './api';
import { ItemSelect, Seg } from './ui';

const KINDS = ['customer', 'dealer', 'guest', 'company', 'agent', 'franchise'] as const;

/** Price lists and the rate board (phase 13): who pays what from which day, and the day's rate for things sold by weight. */
export function PricesPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'lists' | 'board'>('lists');
  const [edit, setEdit] = useState<Partial<PriceList> | null>(null);
  const admin = hasPermission(me.user.permissions, 'ims.admin');
  return (
    <div>
      <PageHeader
        title={t('stock.prices.title')}
        subtitle={t('stock.prices.subtitle')}
        actions={
          tab === 'lists' &&
          admin && (
            <Button variant="primary" onClick={() => setEdit({})}>
              <Plus /> {t('stock.prices.newList')}
            </Button>
          )
        }
      />
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { key: 'lists', label: t('stock.prices.lists') },
          { key: 'board', label: t('stock.prices.board') },
        ]}
      />
      {tab === 'lists' ? (
        <Lists onEdit={admin ? setEdit : undefined} />
      ) : (
        <Board canSet={hasPermission(me.user.permissions, 'ims.edit')} />
      )}
      {edit && <ListDialog list={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Lists({ onEdit }: { onEdit?: (l: PriceList) => void }) {
  const { t } = useTranslation();
  const q = usePriceLists();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data.length)
    return <EmptyState icon={Tags} title={t('stock.prices.noLists')} body={t('stock.prices.noListsBody')} />;
  return (
    <ul className="space-y-2">
      {q.data.map((l) => (
        <li key={l.id}>
          <Card>
            <button
              type="button"
              disabled={!onEdit}
              onClick={() => onEdit?.(l)}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left"
            >
              <div className="min-w-0 flex-1 basis-48">
                <div className="truncate font-medium">{l.name}</div>
                <div className="text-xs text-muted-foreground">
                  {l.partyKind ? t(`money.partyKind.${l.partyKind}`) : t('stock.prices.everyone')} ·{' '}
                  {t('stock.prices.fromDay', { date: formatLocalDate(l.from) })}
                  {l.to && ` – ${formatLocalDate(l.to)}`}
                </div>
              </div>
              <span className="text-sm text-muted-foreground">
                {t('stock.prices.itemCount', { count: l.lines.length })}
              </span>
            </button>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function ListDialog({ list, onClose }: { list: Partial<PriceList>; onClose: () => void }) {
  const { t } = useTranslation();
  const items = useItems();
  const today = useToday();
  const [d, setD] = useState({
    name: list.name ?? '',
    partyKind: list.partyKind ?? '',
    from: list.from ?? today,
    to: list.to ?? '',
  });
  const [lines, setLines] = useState(
    list.lines?.length
      ? list.lines.map((l) => ({ itemId: l.itemId, price: String(l.price / 100) }))
      : [{ itemId: '', price: '' }],
  );
  const kept = lines.filter((l) => l.itemId && l.price !== '');
  const body = {
    name: d.name,
    partyKind: d.partyKind || null,
    from: d.from,
    to: d.to || null,
    lines: kept.map((l) => ({ itemId: l.itemId, price: toPaise(l.price) })),
  };
  const save = useStockMutation(
    () => (list.id ? put(`/api/ims/price-lists/${list.id}`, body) : post('/api/ims/price-lists', body)),
    t('org.saved'),
  );
  const set = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={list.id ? list.name : t('stock.prices.newList')}
      footer={
        <Button
          variant="primary"
          disabled={d.name.trim().length < 2 || !d.from || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('org.name')}>
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('stock.prices.forWhom')}>
          <Select value={d.partyKind} onChange={(e) => setD({ ...d, partyKind: e.target.value })}>
            <option value="">{t('stock.prices.everyone')}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`money.partyKind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('stock.prices.from')}>
          <DateInput
            value={d.from}
            onChange={(from) => setD({ ...d, from })}
            aria-label={t('stock.prices.from')}
          />
        </Field>
        <Field label={t('stock.prices.to')}>
          <DateInput value={d.to} onChange={(to) => setD({ ...d, to })} aria-label={t('stock.prices.to')} />
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_auto] gap-2">
            <ItemSelect
              label={t('stock.item')}
              value={l.itemId}
              items={(items.data?.items ?? []).filter((x) => x.active)}
              onChange={(itemId) => set(i, { itemId })}
            />
            <Input
              aria-label={t('stock.prices.price')}
              placeholder={t('stock.prices.price')}
              inputMode="decimal"
              value={l.price}
              onChange={(e) => set(i, { price: e.target.value })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.remove')}
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => setLines([...lines, { itemId: '', price: '' }])}>
          <Plus /> {t('stock.addLine')}
        </Button>
      </div>
    </Dialog>
  );
}

function Board({ canSet }: { canSet: boolean }) {
  const { t } = useTranslation();
  const q = useBoard();
  const [d, setD] = useState({ key: '', rate: '', unit: 'g' });
  const save = useStockMutation(
    () => put('/api/ims/rate-board', { key: d.key, rate: toPaise(d.rate), unit: d.unit || null }),
    t('stock.prices.rateSaved'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-muted-foreground">{t('stock.prices.boardIntro')}</p>
      {canSet && (
        <Card className="grid grid-cols-2 items-end gap-2 p-3 sm:grid-cols-[1fr_140px_90px_auto]">
          <Field label={t('stock.prices.rateKey')}>
            <Input
              value={d.key}
              placeholder="GOLD24"
              className="font-mono"
              onChange={(e) => setD({ ...d, key: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label={t('stock.prices.todayRate')}>
            <Input
              inputMode="decimal"
              value={d.rate}
              onChange={(e) => setD({ ...d, rate: e.target.value })}
            />
          </Field>
          <Field label={t('stock.prices.per')}>
            <Input value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} />
          </Field>
          <Button
            variant="primary"
            disabled={!d.key || d.rate === '' || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: () => setD({ ...d, rate: '' }) })}
          >
            {t('stock.prices.setRate')}
          </Button>
        </Card>
      )}
      {q.data.length === 0 && <p className="text-sm text-muted-foreground">{t('stock.prices.noRates')}</p>}
      <ul className="space-y-2">
        {q.data.map((r) => (
          <li key={r.key}>
            <Card className="flex items-center justify-between gap-3 p-3">
              <div>
                <div className="font-mono font-medium">{r.key}</div>
                <div className="text-xs text-muted-foreground">
                  {t('stock.prices.asOf', { date: formatLocalDate(r.date) })}
                </div>
              </div>
              <span className="tabular font-semibold">
                {rupees(r.rate)}
                {r.unit ? ` / ${r.unit}` : ''}
              </span>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
