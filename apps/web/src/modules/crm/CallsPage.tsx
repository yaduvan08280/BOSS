import {
  Check,
  Clock,
  LayoutGrid,
  List,
  Loader2,
  Phone,
  PhoneCall,
  ShoppingBag,
  ThumbsDown,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, formatLocalDate, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { useUsers } from '@/modules/system/api';
import { crmApi, inr, useCalls, useCrmMutation, type CallRow } from './api';
import { emptyOrder, orderBody } from './order';
import { OrderForm } from './OrderForm';

const FILTERS = ['due', 'winback', 'done'] as const;
type Result = 'ORDER' | 'LATER' | 'NOT_NOW' | 'LOST';

/** Sales CRM → Today's Calls (§11.2): cards or a grid, one tap to a result. */
export function CallsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [sc, setSc] = useState('');
  const q = useCalls(sc || undefined);
  const users = useUsers();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('due');
  const [grid, setGrid] = useState(false);
  const [answering, setAnswering] = useState<{ call: CallRow; result: Result } | null>(null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const d = q.data;
  const rows = d.calls.filter((c) =>
    filter === 'done'
      ? c.status === 'DONE'
      : c.status === 'OPEN' && (filter === 'winback' ? c.kind === 'winback' : c.kind === 'scot'),
  );
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.calls')} subtitle={t('navDesc.calls')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiTile label={t('crm.k.due')} value={d.tiles.due} hero />
        <KpiTile label={t('crm.k.done')} value={d.tiles.done} />
        <KpiTile label={t('crm.k.taken')} value={inr(d.tiles.takenToday, true)} />
        <KpiTile label={t('crm.k.crrToday')} value={inr(d.tiles.crrToday, true)} />
        <KpiTile label={t('crm.k.winBack')} value={d.tiles.winBack} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('crm.sc.show')}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'h-9 rounded-pill border px-3 text-sm',
                filter === f ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
              )}
            >
              {t(`crm.k.f.${f}`)}
            </button>
          ))}
        </div>
        {d.canPickSc && (
          <Select
            value={sc}
            onChange={(e) => setSc(e.target.value)}
            aria-label={t('crm.sc.bySc')}
            className="w-48"
          >
            <option value="">{t('crm.sc.allSc')}</option>
            {(users.data ?? [])
              .filter((u) => u.status === 'ACTIVE')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </Select>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            size="icon-sm"
            variant={grid ? 'ghost' : 'secondary'}
            aria-label={t('crm.k.cards')}
            onClick={() => setGrid(false)}
          >
            <LayoutGrid />
          </Button>
          <Button
            size="icon-sm"
            variant={grid ? 'secondary' : 'ghost'}
            aria-label={t('crm.k.grid')}
            onClick={() => setGrid(true)}
          >
            <List />
          </Button>
        </div>
      </div>
      {!rows.length ? (
        <EmptyState icon={PhoneCall} title={t(`crm.k.none.${filter}`)} />
      ) : grid ? (
        <ul className="divide-y rounded-card border bg-card">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="font-medium">
                {c.customer.name} <span className="text-xs text-muted-foreground">{c.customer.city}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums text-muted-foreground">{inr(c.averageOrder, true)}</span>
                <Actions call={c} onPick={(result) => setAnswering({ call: c, result })} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <li key={c.id} className="space-y-3 rounded-card border bg-card p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{c.customer.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[c.customer.city, c.sc].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {c.status === 'DONE' ? (
                  <StatusChip tone="ok">{t(`crm.k.result.${c.result}`)}</StatusChip>
                ) : c.lateDays > 0 ? (
                  <StatusChip tone="bad">{t('crm.k.late', { count: c.lateDays })}</StatusChip>
                ) : c.kind === 'winback' ? (
                  <StatusChip tone="info">{t('crm.k.winBackChip')}</StatusChip>
                ) : (
                  <StatusChip tone="warn">{t('crm.sc.dueToday')}</StatusChip>
                )}
              </div>
              {c.customer.mobile && (
                <a
                  href={`tel:${c.customer.mobile}`}
                  className="inline-flex h-11 items-center gap-2 rounded-control border px-3 font-medium"
                >
                  <Phone className="size-4" /> {c.customer.mobile}
                </a>
              )}
              <p className="text-muted-foreground">
                {c.everyDays
                  ? t('crm.k.usually', { average: inr(c.averageOrder, true), every: c.everyDays })
                  : t('crm.k.noRhythm')}
                {c.topItems.length > 0 && ` · ${c.topItems.join(', ')}`}
              </p>
              <div className="text-xs text-muted-foreground">
                {t('crm.k.lastDue', {
                  last: c.lastOrder ? formatLocalDate(c.lastOrder) : '—',
                  due: c.nextDue ? formatLocalDate(c.nextDue) : '—',
                })}
              </div>
              {c.status === 'OPEN' && (
                <Actions call={c} onPick={(result) => setAnswering({ call: c, result })} />
              )}
            </li>
          ))}
        </ul>
      )}
      {answering && (
        <ResultDialog
          call={answering.call}
          result={answering.result}
          today={d.today}
          tz={me.company.timezone}
          onClose={() => setAnswering(null)}
        />
      )}
    </div>
  );
}

function Actions({ call, onPick }: { call: CallRow; onPick: (r: Result) => void }) {
  const { t } = useTranslation();
  if (call.status !== 'OPEN') return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" onClick={() => onPick('ORDER')}>
        <ShoppingBag /> {t('crm.k.order')}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onPick('LATER')}>
        <Clock /> {t('crm.k.later')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onPick('NOT_NOW')}>
        <X /> {t('crm.k.notNow')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onPick('LOST')}>
        <ThumbsDown /> {t('crm.k.lost')}
      </Button>
    </div>
  );
}

function ResultDialog({
  call,
  result,
  today,
  onClose,
}: {
  call: CallRow;
  result: Result;
  today: string;
  tz: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [r, setR] = useState<Result>(result);
  const [nextOn, setNextOn] = useState(addDays(today, 2));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [order, setOrder] = useState(emptyOrder(addDays(today, 3)));
  const body = orderBody(order);
  const ok =
    r === 'ORDER'
      ? Boolean(body)
      : r === 'LATER'
        ? nextOn >= today
        : r === 'LOST'
          ? reason.trim().length >= 3
          : true;
  const save = useCrmMutation(
    () =>
      crmApi.answer(call.id, {
        result: r,
        note: note.trim() || undefined,
        nextOn: r === 'LATER' ? nextOn : undefined,
        lostReason: r === 'LOST' ? reason.trim() : undefined,
        order: r === 'ORDER' ? body : undefined,
      }),
    (x) => (x.order ? t('crm.o.taken', { number: x.order.number }) : t('crm.k.saved')),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={call.customer.name}
      wide={r === 'ORDER'}
      footer={
        <Button
          disabled={!ok || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} {t('crm.k.saveResult')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('crm.k.result.label')}>
          {(['ORDER', 'LATER', 'NOT_NOW', 'LOST'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={r === k}
              onClick={() => setR(k)}
              className={cn(
                'h-9 rounded-pill border px-3 text-sm',
                r === k ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
              )}
            >
              {t(`crm.k.result.${k}`)}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{t(`crm.k.resultHint.${r}`)}</p>
        {r === 'ORDER' && <OrderForm value={order} onChange={setOrder} />}
        {r === 'LATER' && (
          <Field label={t('crm.k.callOn')}>
            <DateInput value={nextOn} min={today} onChange={setNextOn} aria-label={t('crm.k.callOn')} />
          </Field>
        )}
        {r === 'LOST' && (
          <Field label={t('crm.k.whyLost')}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {r !== 'ORDER' && (
          <Field label={t('crm.o.note')}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
