import { EinvoiceButton } from '@/modules/connect/EinvoiceButton';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, hasPermission, MONEY_BILLS, type BillType, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  BILL_KINDS,
  money,
  STATUS_TONE,
  useBill,
  useBills,
  useMoneyMutation,
  useParties,
  type Bill,
} from './api';
import { BillForm } from './BillForm';

const TABS: (BillType | '')[] = ['', 'INVOICE', 'PURCHASE_BILL', 'RECEIPT', 'VENDOR_PAYMENT', 'CREDIT_NOTE'];

/** Every money paper in one place: invoices, purchase bills, receipts, payments and notes. */
export function BillsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [type, setType] = useState<BillType | ''>('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [make, setMake] = useState<BillType | null>(null);
  const bills = useBills({ type: type || undefined });
  const parties = useParties();
  const name = new Map((parties.data ?? []).map((p) => [p.id, p.name]));
  const canMake = hasPermission(me.user.permissions, 'money.create');
  const rows = (bills.data ?? []).filter((b) => {
    const q = search.trim().toLowerCase();
    return !q || `${b.number ?? ''} ${name.get(b.partyId) ?? ''}`.toLowerCase().includes(q);
  });
  return (
    <div>
      <PageHeader
        title={t('money.bills.title')}
        subtitle={t('money.bills.subtitle')}
        actions={
          canMake && (
            <Select
              aria-label={t('money.bills.new')}
              value=""
              onChange={(e) => e.target.value && setMake(e.target.value as BillType)}
              className="w-44"
            >
              <option value="">{`+ ${t('money.bills.new')}`}</option>
              {BILL_KINDS.filter((k) => k !== 'CREDIT_NOTE' && k !== 'DEBIT_NOTE').map((k) => (
                <option key={k} value={k}>
                  {t(`money.kind.${k}`)}
                </option>
              ))}
            </Select>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1" role="tablist">
          {TABS.map((k) => (
            <button
              key={k || 'all'}
              role="tab"
              aria-selected={type === k}
              onClick={() => setType(k)}
              className={cn(
                'h-9 shrink-0 rounded-pill border px-3 text-sm font-medium',
                type === k
                  ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                  : 'bg-card text-muted-foreground',
              )}
            >
              {k ? t(`money.kinds.${k}`) : t('money.bills.all')}
            </button>
          ))}
        </div>
        <Input
          aria-label={t('money.bills.search')}
          placeholder={t('money.bills.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:ml-auto sm:w-64"
        />
      </div>
      {bills.isPending ? (
        <PageSkeleton />
      ) : bills.isError ? (
        <ErrorState onRetry={() => void bills.refetch()} error={bills.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title={t('money.bills.emptyTitle')} body={t('money.bills.emptyBody')} />
      ) : (
        <ul className="space-y-2">
          {rows.map((b) => (
            <li key={b.id}>
              <Card>
                <button
                  type="button"
                  onClick={() => setOpen(b.id)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left"
                >
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate font-medium">{name.get(b.partyId) ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{b.number ?? t('money.draft')}</span> ·{' '}
                      {t(`money.kind.${b.type}`)} · {formatLocalDate(b.date)}
                    </div>
                  </div>
                  <StatusChip tone={STATUS_TONE[b.status]}>{t(`money.status.${b.status}`)}</StatusChip>
                  <div className="text-right">
                    <div className="tabular font-semibold">{money(b.total, b.currency)}</div>
                    {b.due > 0 && (
                      <div className="tabular text-xs text-status-warn-fg">
                        {t('money.dueAmount', { amount: money(b.due, b.currency) })}
                      </div>
                    )}
                  </div>
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {make && <BillForm type={make} onClose={() => setMake(null)} />}
      {open && (
        <BillDrawer
          id={open}
          canMake={canMake}
          canEdit={hasPermission(me.user.permissions, 'money.edit')}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** One paper: its lines and taxes, what is still owed, and what can be done with it. */
function BillDrawer({
  id,
  canMake,
  canEdit,
  onClose,
}: {
  id: string;
  canMake: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useBill(id);
  const [next, setNext] = useState<{ type: BillType; against?: Bill } | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const issue = useMoneyMutation(
    () => api<Bill>(`/api/money/bills/${id}/issue`, { method: 'POST', body: {} }),
    (b) => t('money.saved', { number: b.number }),
  );
  const undo = useMoneyMutation(
    (reason: string) => api(`/api/money/bills/${id}/void`, { method: 'POST', body: { reason } }),
    t('money.voided'),
  );
  const b = q.data;
  const isMoney = b ? MONEY_BILLS.includes(b.type) : false;
  const row = (label: string, value: string, strong = false) => (
    <div className={cn('flex justify-between gap-3', strong && 'border-t pt-1 text-base font-semibold')}>
      <dt className={strong ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
  return (
    <>
      <Dialog
        open
        wide
        onOpenChange={(o) => !o && onClose()}
        title={
          b ? `${t(`money.kind.${b.type}`)} ${b.number ?? `(${t('money.draft')})`}` : t('money.bills.title')
        }
        description={b ? `${b.party?.name ?? ''} · ${formatLocalDate(b.date)}` : undefined}
        footer={
          b && (
            <>
              {b.status === 'DRAFT' && canMake && (
                <>
                  <Button
                    variant="ghost"
                    disabled={undo.isPending}
                    onClick={() => undo.mutate(t('money.discarded'), { onSuccess: onClose })}
                  >
                    {t('money.discard')}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={issue.isPending}
                    onClick={() => issue.mutate(undefined)}
                  >
                    {t('money.issue')}
                  </Button>
                </>
              )}
              {isMoney && b.status === 'ISSUED' && canEdit && (
                <Button variant="ghost" disabled={undo.isPending} onClick={() => setVoiding('')}>
                  {t('money.void')}
                </Button>
              )}
              {!isMoney &&
                ['ISSUED', 'PART_PAID', 'PAID'].includes(b.status) &&
                canMake &&
                (b.type === 'INVOICE' || b.type === 'PURCHASE_BILL') && (
                  <Button variant="secondary" onClick={() => setNext({ type: 'CREDIT_NOTE', against: b })}>
                    {t('money.creditNote')}
                  </Button>
                )}
              {canEdit && <EinvoiceButton bill={b} />}
              {b.due > 0 && canMake && (
                <Button
                  variant="primary"
                  onClick={() => setNext({ type: b.type === 'PURCHASE_BILL' ? 'VENDOR_PAYMENT' : 'RECEIPT' })}
                >
                  {b.type === 'PURCHASE_BILL' ? t('money.pay') : t('money.takePayment')}
                </Button>
              )}
            </>
          )
        }
      >
        {q.isPending ? (
          <div className="h-32 animate-pulse rounded-control bg-muted" />
        ) : q.isError || !b ? (
          <ErrorState onRetry={() => void q.refetch()} error={q.error} />
        ) : (
          <div className="space-y-4 text-sm">
            <StatusChip tone={STATUS_TONE[b.status]}>{t(`money.status.${b.status}`)}</StatusChip>
            {b.lines.length > 0 && (
              <ul className="divide-y rounded-control border">
                {b.lines.map((l, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      {l.item}
                      <span className="block text-xs text-muted-foreground">
                        {`${l.qty} × ${money(l.rate, b.currency)}`}
                        {l.taxPercent ? ` · ${l.taxPercent}%` : ''}
                        {l.hsn ? ` · HSN ${l.hsn}` : ''}
                      </span>
                    </span>
                    <span className="tabular">{money(l.total ?? 0, b.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="ml-auto max-w-xs space-y-1">
              {!isMoney && row(t('money.taxable'), money(b.taxable, b.currency))}
              {b.taxes.map((x) => (
                <div key={`${x.name}${x.percent}`}>
                  {row(`${x.name} ${x.percent}%`, money(x.amount, b.currency))}
                </div>
              ))}
              {b.roundOff !== 0 && row(t('money.roundOff'), money(b.roundOff, b.currency))}
              {row(t('money.total'), money(b.total, b.currency), true)}
              {b.credited > 0 && row(t('money.credited'), money(b.credited, b.currency))}
              {b.settled > 0 &&
                row(isMoney ? t('money.usedSoFar') : t('money.paidSoFar'), money(b.settled, b.currency))}
              {b.due > 0 && row(t('money.stillDue'), money(b.due, b.currency))}
            </dl>
            {b.reference && (
              <p className="text-xs text-muted-foreground">{t('money.referenceIs', { ref: b.reference })}</p>
            )}
            {b.einvoice && (
              <p className="text-xs break-all text-muted-foreground" data-testid="irn">
                {b.einvoice.cancelledAt ? t('connect.irnCancelled') : t('connect.irn')}: {b.einvoice.irn}
                {b.einvoice.ackNo ? ` · ${t('connect.ack')} ${b.einvoice.ackNo}` : ''}
              </p>
            )}
          </div>
        )}
      </Dialog>
      {voiding !== null && (
        <Dialog
          open
          onOpenChange={(o) => !o && setVoiding(null)}
          title={t('money.void')}
          footer={
            <Button
              variant="destructive"
              disabled={voiding.trim().length < 3 || undo.isPending}
              onClick={() => undo.mutate(voiding.trim(), { onSuccess: onClose })}
            >
              {t('money.void')}
            </Button>
          }
        >
          <Field label={t('money.voidWhy')}>
            <Textarea value={voiding} onChange={(e) => setVoiding(e.target.value)} autoFocus />
          </Field>
        </Dialog>
      )}
      {next && b && (
        <BillForm type={next.type} against={next.against} partyId={b.partyId} onClose={() => setNext(null)} />
      )}
    </>
  );
}
