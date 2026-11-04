import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Lock,
  LockOpen,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatINR, formatLocalDate } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { cn } from '@/lib/utils';
import { useHrMutation } from './api';
import { payApi, payCsv, usePaySheet, type PayLine } from './payApi';

export const inr = (paise: number) => formatINR(Math.round(paise));

/** One month's gross pay from attendance: a card a person, the lines behind it, close / reopen, CSV. */
export function PayMonth({ today, tz }: { today: string; tz: string }) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [search, setSearch] = useState('');
  const [reopen, setReopen] = useState(false);
  const q = usePaySheet(month);
  const close = useHrMutation(
    () => payApi.close(month),
    () => t('hr.p.closedToast'),
  );
  const [y, m] = month.split('-').map(Number) as [number, number];
  const shift = (by: number) => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const label = new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  const ended = month < today.slice(0, 7);
  const lines = (q.data?.lines ?? []).filter(
    (l) =>
      !search.trim() ||
      matchScore(search, [l.user.name, l.user.code, l.user.department, l.user.designation].join(' ')) > 0,
  );
  const exportCsv = () => {
    const csv = payCsv(q.data!, (k) =>
      t(`hr.p.csv.${k}`, { defaultValue: t(`hr.p.line.${k}`, { defaultValue: k }) }),
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }));
    a.download = `pay-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label={t('hr.a.prevMonth')} onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <div className="min-w-36 text-center text-sm font-semibold">{label}</div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('hr.a.nextMonth')}
            disabled={!ended}
            onClick={() => shift(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        {q.data && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!q.data.lines.length}>
              <Download /> {t('hr.p.csvButton')}
            </Button>
            {q.data.closed ? (
              <Button variant="secondary" size="sm" onClick={() => setReopen(true)}>
                <LockOpen /> {t('hr.p.reopen')}
              </Button>
            ) : (
              ended && (
                <Button
                  size="sm"
                  disabled={close.isPending || !q.data.lines.length}
                  onClick={() => close.mutate(undefined)}
                >
                  {close.isPending ? <Loader2 className="animate-spin" /> : <Lock />} {t('hr.p.close')}
                </Button>
              )
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('hr.p.grossOnly')}</p>
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <KpiTile label={t('hr.p.total')} value={inr(q.data.totalPaise)} hero />
            <KpiTile label={t('hr.p.people')} value={q.data.lines.length} />
            <KpiTile
              label={t('hr.p.state')}
              value={q.data.closed ? t('hr.p.closed') : t('hr.p.open')}
              note={
                q.data.closed
                  ? t('hr.p.closedBy', {
                      name: q.data.closed.by ?? '—',
                      at: formatDateTime(q.data.closed.at, tz),
                    })
                  : ended
                    ? t('hr.p.toClose')
                    : t('hr.p.soFar', { date: formatLocalDate(q.data.asOf) })
              }
            />
          </div>
          {!q.data.lines.length ? (
            <EmptyState icon={Wallet} title={t('hr.p.empty')} body={t('hr.p.emptyBody')} />
          ) : (
            <>
              <Input
                aria-label={t('hr.p.search')}
                placeholder={t('hr.p.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:w-72"
              />
              {!lines.length && <p className="text-sm text-muted-foreground">{t('common.noMatch')}</p>}
              <ul className="space-y-2">
                {lines.map((l) => (
                  <PersonPay key={l.user.id} l={l} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <ReopenDialog open={reopen} onOpenChange={setReopen} month={month} />
    </div>
  );
}

function PersonPay({ l }: { l: PayLine }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const c = l.counts;
  const chips = [
    [t('hr.p.c.present'), c.present + c.halfDays / 2],
    [t('hr.p.c.absent'), c.absent],
    [t('hr.p.c.leave'), c.paidLeave],
    [t('hr.p.c.unpaidLeave'), c.unpaidLeave],
    [t('hr.p.c.offWorked'), c.offDaysWorked],
    [t('hr.p.c.late'), c.late],
    [t('hr.p.c.overtime'), c.overtimeHours ? `${c.overtimeHours} h` : 0],
  ].filter(([, v]) => v) as [string, string | number][];
  return (
    <li className="rounded-card border bg-card text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-start justify-between gap-2 p-4 text-left"
      >
        <div className="min-w-0">
          <div className="font-semibold">{l.user.name}</div>
          <div className="text-xs text-muted-foreground">
            {[l.user.code, l.user.department, l.user.designation].filter(Boolean).join(' · ')}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t(`hr.p.rateOf.${l.basis}`, { amount: inr(l.ratePaise) })}
            {l.pattern.kind !== 'shift' &&
              ` · ${l.pattern.kind === 'daily' ? t('hr.p.hoursDay', { n: l.pattern.hours }) : t('hr.p.weekly')}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold tabular-nums">{inr(l.grossPaise)}</span>
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </div>
        <div className="flex w-full flex-wrap gap-1.5">
          {chips.map(([k, v]) => (
            <span key={k} className="rounded-pill bg-muted px-2 py-0.5 text-xs">
              {k} <b className="tabular-nums">{v}</b>
            </span>
          ))}
          {l.warnings.map((w) => (
            <StatusChip key={w} tone="warn">
              {t(`hr.p.warn.${w}`)}
            </StatusChip>
          ))}
        </div>
      </button>
      {open && (
        <table className="w-full border-t text-sm">
          <tbody>
            {l.lines.map((x) => (
              <tr key={x.key} className="border-b last:border-0">
                <td className="px-4 py-2">{t(`hr.p.line.${x.key}`)}</td>
                <td className="px-2 py-2 text-right text-xs text-muted-foreground tabular-nums">
                  {x.key === 'base' ? '' : `${x.qty} × ${inr(x.ratePaise)}`}
                </td>
                <td
                  className={cn(
                    'px-4 py-2 text-right font-medium tabular-nums',
                    x.amountPaise < 0 && 'text-status-bad-fg',
                  )}
                >
                  {inr(x.amountPaise)}
                </td>
              </tr>
            ))}
            <tr className="bg-muted/50 font-semibold">
              <td className="px-4 py-2">{t('hr.p.gross')}</td>
              <td className="px-2 py-2 text-right text-xs font-normal text-muted-foreground">
                {l.divisor ? t('hr.p.dayValue', { n: l.divisor, amount: inr(l.perDayPaise) }) : ''}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{inr(l.grossPaise)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </li>
  );
}

function ReopenDialog({
  open,
  onOpenChange,
  month,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  month: string;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const go = useHrMutation(
    () => payApi.reopen(month, reason.trim()),
    () => t('hr.p.reopenedToast'),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('hr.p.reopenTitle')}
      description={t('hr.p.reopenBody')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={reason.trim().length < 3 || go.isPending}
            onClick={() => go.mutate(undefined, { onSuccess: () => (onOpenChange(false), setReason('')) })}
          >
            <LockOpen /> {t('hr.p.reopen')}
          </Button>
        </>
      }
    >
      <Field label={t('hr.p.why')}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Field>
    </Dialog>
  );
}
