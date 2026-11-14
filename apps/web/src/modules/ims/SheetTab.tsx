import { Check, ClipboardCheck, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatINR, MOVE_TYPES } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { cn } from '@/lib/utils';
import { imsApi, qty, useImsMutation, useMoves, type MoveRow } from './api';

const TONE = { APPLIED: 'ok', PENDING: 'warn', REJECTED: 'bad' } as const;

/** The IMS sheet (§10.3): every in and out in one list, newest first. */
export function SheetTab({ tz, today }: { tz: string; today: string }) {
  const { t } = useTranslation();
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const q = useMoves({ type: type || undefined, from: from || undefined, to: to || undefined });
  const rows = (q.data ?? []).filter(
    (m) => !search.trim() || matchScore(search, [m.item.code, m.item.name, m.note, m.by].join(' ')) > 0,
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('ims.s.search')}
          placeholder={t('ims.s.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 sm:max-w-64"
        />
        <Select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label={t('ims.m.kind')}
          className="w-40"
        >
          <option value="">{t('ims.sh.allTypes')}</option>
          {MOVE_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`ims.type.${k}`)}
            </option>
          ))}
        </Select>
        <DateInput value={from} onChange={setFrom} aria-label={t('ims.sh.from')} className="w-40" />
        <DateInput value={to} onChange={setTo} aria-label={t('ims.sh.to')} className="w-40" />
      </div>
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">
          {q.data.length ? t('common.noMatch') : t('ims.sh.empty')}
        </p>
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {rows.map((m) => (
            <MoveLine key={m.id} m={m} tz={tz} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MoveLine({ m, tz, actions }: { m: MoveRow; tz: string; actions?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="font-medium">
          {m.item.name} <span className="font-mono text-xs text-muted-foreground">{m.item.code}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {[
            formatDateTime(m.at, tz),
            t(`ims.type.${m.type}`),
            m.reason && t(`ims.reason.${m.reason}`),
            m.type === 'TRANSFER' && `${m.fromLocation ?? '—'} → ${m.toLocation}`,
            m.by,
            m.note,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {m.status !== 'APPLIED' && (
          <StatusChip tone={TONE[m.status]}>{t(`ims.mstatus.${m.status}`)}</StatusChip>
        )}
        <span
          className={cn(
            'font-semibold tabular-nums',
            m.qty < 0 ? 'text-status-bad-fg' : m.qty > 0 ? 'text-status-ok-fg' : '',
          )}
        >
          {m.qty > 0 ? '+' : ''}
          {qty(m.qty)} {m.item.unit}
        </span>
        {m.balance !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('ims.sh.balance', { n: qty(m.balance) })}
          </span>
        )}
        {actions}
      </div>
    </li>
  );
}

/** Adjustments waiting for an approver (damaged, expired, lost, found, counted). */
export function ApprovalsTab({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const q = useMoves({ status: 'PENDING' });
  const decide = useImsMutation(
    (x: { id: string; approve: boolean }) => imsApi.decide(x.id, x.approve),
    (r) =>
      t(
        r.status === 'PENDING'
          ? 'ims.ap.partly'
          : r.status === 'APPLIED'
            ? 'ims.ap.applied'
            : 'ims.ap.rejected',
      ),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  if (!q.data.length) return <EmptyState icon={ClipboardCheck} title={t('ims.ap.none')} />;
  return (
    <ul className="divide-y rounded-card border bg-card">
      {q.data.map((m) => (
        <MoveLine
          key={m.id}
          m={m}
          tz={tz}
          actions={
            m.canDecide ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: m.id, approve: true })}
                >
                  <Check /> {t('ims.ap.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: m.id, approve: false })}
                >
                  <X /> {t('ims.ap.reject')}
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">
                {m.ratePaise &&
                  formatINR(Math.round(Math.abs(m.qty) * Number(m.ratePaise)), { compact: true })}{' '}
                · {t('ims.ap.waiting')}
              </span>
            )
          }
        />
      ))}
    </ul>
  );
}
