import { BadgeIndianRupee, Loader2, MessageSquarePlus, Send, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { Bars } from './charts';
import {
  crmApi,
  inr,
  toPaise,
  useCollectionLog,
  useCollections,
  useCrmMutation,
  type Collections,
} from './api';
import { MoneyInput } from './setup/shell';

const BUCKETS = ['0_30', '31_60', '61_90', '90_plus'] as const;

/** Sales CRM → Collections (§11.2): what each customer owes by age, promises, the follow-up log, statements. */
export function CollectionsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useCollections();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Collections['rows'][number] | null>(null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const d = q.data;
  const rows = d.rows.filter(
    (r) => !search.trim() || matchScore(search, [r.name, r.city, r.mobile].join(' ')) > 0,
  );
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.collections')} subtitle={t('navDesc.collections')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiTile label={t('crm.col.receivable')} value={inr(d.tiles.receivable, true)} hero />
        <KpiTile
          label={t('crm.col.overdue')}
          value={inr(d.tiles.overdue, true)}
          tone={Number(d.tiles.overdue) ? 'bad' : undefined}
        />
        <KpiTile label={t('crm.col.dueToday')} value={inr(d.tiles.dueToday, true)} />
        <KpiTile
          label={t('crm.col.over90')}
          value={inr(d.tiles.over90, true)}
          tone={Number(d.tiles.over90) ? 'bad' : undefined}
        />
        <KpiTile label={t('crm.col.promised')} value={d.tiles.promisedThisWeek} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('crm.col.ageing')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Bars
            label={t('crm.col.ageing')}
            className="h-24"
            data={BUCKETS.map((b) => ({ label: b, value: Number(d.ageing[b]) }))}
          />
          <div className="grid grid-cols-4 text-center text-xs">
            {BUCKETS.map((b) => (
              <span key={b}>
                <span className="block text-muted-foreground">{t(`crm.col.b.${b}`)}</span>
                <b className="tabular-nums">{inr(d.ageing[b], true)}</b>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
      <Input
        aria-label={t('crm.c.search')}
        placeholder={t('crm.c.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="sm:max-w-72"
      />
      {!d.rows.length ? (
        <EmptyState icon={Wallet} title={t('crm.col.none')} />
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {rows.map((r) => (
            <li key={r.customerId}>
              <button
                type="button"
                onClick={() => setOpen(r)}
                className="grid w-full gap-2 px-4 py-3 text-left text-sm hover:bg-muted/40 sm:grid-cols-[minmax(0,1.5fr)_repeat(4,6rem)_8rem]"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.promisedOn
                      ? t('crm.col.promisedOn', { date: formatLocalDate(r.promisedOn) })
                      : (r.lastNote?.note ?? t('crm.col.noFollowUp'))}
                    {r.brokenPromise && (
                      <StatusChip tone="bad" className="ml-1">
                        {t('crm.col.broken')}
                      </StatusChip>
                    )}
                  </div>
                </div>
                {BUCKETS.map((b) => (
                  <span key={b} className="hidden text-right tabular-nums text-muted-foreground sm:block">
                    {Number(r.ageing[b]) ? inr(r.ageing[b], true) : '—'}
                  </span>
                ))}
                <span className="text-right">
                  <b className="tabular-nums">{inr(r.receivable, true)}</b>
                  {Number(r.overdue) > 0 && (
                    <span className="block text-xs text-status-bad-fg">
                      {t('crm.c.overdue', { amount: inr(r.overdue, true) })}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <Customer row={open} me={me} today={d.today} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Customer({
  row,
  me,
  today,
  onClose,
}: {
  row: Collections['rows'][number];
  me: Me;
  today: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const log = useCollectionLog(row.customerId);
  const [paying, setPaying] = useState(false);
  const [noting, setNoting] = useState(false);
  const can = hasPermission(me.user.permissions, 'crm.create');
  const statement = useCrmMutation(
    () => crmApi.statement(row.customerId),
    () => t('crm.col.statementSent'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={row.name}
      description={t('crm.col.owes', { amount: inr(row.receivable), credit: row.creditDays })}
      footer={
        can && (
          <>
            <Button
              variant="secondary"
              disabled={statement.isPending || (!row.mobile && !row.email)}
              onClick={() => statement.mutate(undefined)}
            >
              <Send /> {t('crm.col.sendStatement')}
            </Button>
            <Button variant="secondary" onClick={() => setNoting(true)}>
              <MessageSquarePlus /> {t('crm.col.addFollowUp')}
            </Button>
            <Button onClick={() => setPaying(true)}>
              <BadgeIndianRupee /> {t('crm.col.recordPayment')}
            </Button>
          </>
        )
      }
    >
      {log.isPending ? (
        <PageSkeleton />
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <div className="mb-1 font-medium">{t('crm.col.log')}</div>
            {!log.data?.notes.length ? (
              <p className="text-muted-foreground">{t('crm.col.noFollowUp')}</p>
            ) : (
              <ul className="divide-y rounded-control border">
                {log.data.notes.map((n) => (
                  <li key={n.id} className="px-3 py-2">
                    <div>
                      {n.note}
                      {n.promisedOn && (
                        <b>
                          {' '}
                          · {t('crm.col.promisedOn', { date: formatLocalDate(n.promisedOn) })}
                          {n.promisedAmount && ` (${inr(n.promisedAmount)})`}
                        </b>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[t(`crm.col.kind.${n.kind}`), n.by, formatDateTime(n.at, me.company.timezone)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 font-medium">{t('crm.col.payments')}</div>
            {!log.data?.payments.length ? (
              <p className="text-muted-foreground">—</p>
            ) : (
              <ul className="divide-y rounded-control border">
                {log.data.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 px-3 py-2">
                    <span>
                      {formatLocalDate(p.date)} · {p.mode && t(`crm.col.mode.${p.mode}`)}
                      {p.reference && ` · ${p.reference}`}
                    </span>
                    <b className="tabular-nums">{inr(p.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {paying && (
        <PaymentDialog
          customerId={row.customerId}
          owed={row.receivable}
          today={today}
          onClose={() => setPaying(false)}
        />
      )}
      {noting && <NoteDialog customerId={row.customerId} today={today} onClose={() => setNoting(false)} />}
    </Dialog>
  );
}

function PaymentDialog({
  customerId,
  owed,
  today,
  onClose,
}: {
  customerId: string;
  owed: string;
  today: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState('bank');
  const [reference, setReference] = useState('');
  const p = toPaise(amount);
  const save = useCrmMutation(
    () => crmApi.payment({ customerId, amount: p, date, mode, reference: reference || undefined }),
    () => t('crm.col.paid'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('crm.col.recordPayment')}
      description={t('crm.col.owesNow', { amount: inr(owed) })}
      footer={
        <Button
          disabled={!p || p > Number(owed) || date > today || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('crm.col.amount')}>
          <MoneyInput label={t('crm.col.amount')} value={amount} onChange={setAmount} />
        </Field>
        <Field label={t('crm.col.date')}>
          <DateInput value={date} max={today} onChange={setDate} aria-label={t('crm.col.date')} />
        </Field>
        <Field label={t('crm.col.modeLabel')}>
          <Select value={mode} onChange={(e) => setMode(e.target.value)} aria-label={t('crm.col.modeLabel')}>
            {['bank', 'upi', 'cheque', 'cash', 'other'].map((m) => (
              <option key={m} value={m}>
                {t(`crm.col.mode.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('crm.col.reference')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function NoteDialog({
  customerId,
  today,
  onClose,
}: {
  customerId: string;
  today: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [promisedOn, setPromised] = useState('');
  const [amount, setAmount] = useState('');
  const save = useCrmMutation(
    () =>
      crmApi.note({
        customerId,
        note,
        promisedOn: promisedOn || undefined,
        promisedAmount: toPaise(amount) || undefined,
      }),
    () => t('crm.s.saved'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('crm.col.addFollowUp')}
      footer={
        <Button
          disabled={note.trim().length < 2 || (promisedOn !== '' && promisedOn < today) || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label={t('crm.col.whatSaid')}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('crm.col.promiseDate')}>
            <DateInput
              value={promisedOn}
              min={today}
              onChange={setPromised}
              aria-label={t('crm.col.promiseDate')}
            />
          </Field>
          <Field label={t('crm.col.promiseAmount')}>
            <MoneyInput label={t('crm.col.promiseAmount')} value={amount} onChange={setAmount} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
