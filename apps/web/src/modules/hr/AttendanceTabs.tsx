import { AlertTriangle, Check, Loader2, Upload, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatLocalDate } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Textarea } from '@/components/ui/form';
import { useUsers } from '@/modules/system/api';
import { hrApi, STATUS_TONE, useCorrections, useHrMutation, useTeamDay, type Correction } from './api';

const time = (iso: string | null, tz: string) => (iso ? formatDateTime(iso, tz).slice(-5) : '—');

/** One day for the team (HOD) or everyone (HR). */
export function TeamTab({ tz, today }: { tz: string; today: string }) {
  const { t } = useTranslation();
  const [date, setDate] = useState(today);
  const q = useTeamDay(date);
  return (
    <div className="space-y-3">
      <DateInput value={date} onChange={setDate} aria-label={t('hr.a.day')} className="w-44" />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !q.data.rows.length ? (
        <EmptyState icon={Users} title={t('hr.a.noTeam')} />
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {q.data.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  {[r.code, r.department].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {r.flags.length > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-status-warn-fg"
                    title={r.flags.map((f) => f.flagReason).join(', ')}
                  >
                    <AlertTriangle className="size-3.5" /> {r.flags[0]!.flagReason}
                  </span>
                )}
                <span className="tabular-nums text-muted-foreground">
                  {time(r.inAt, tz)} – {time(r.outAt, tz)}
                </span>
                <StatusChip tone={STATUS_TONE[r.status]}>{t(`hr.status.${r.status}`)}</StatusChip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CorrectionRow({
  c,
  tz,
  name,
  decide,
}: {
  c: Correction;
  tz: string;
  name?: string;
  decide?: boolean;
}) {
  const { t } = useTranslation();
  const act = useHrMutation(
    (ok: boolean) => hrApi.decideCorrection(c.id, ok),
    () => t('org.saved'),
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="font-medium">
          {name ? `${name} · ` : ''}
          {formatLocalDate(c.date)}
        </div>
        <div className="text-xs text-muted-foreground">
          {c.inAt && `${t('hr.a.in')} ${time(c.inAt, tz)} `}
          {c.outAt && `${t('hr.a.out')} ${time(c.outAt, tz)} `}· {c.reason}
        </div>
      </div>
      {decide ? (
        <div className="flex gap-1">
          <Button size="sm" variant="primary" disabled={act.isPending} onClick={() => act.mutate(true)}>
            <Check /> {t('hr.a.approve')}
          </Button>
          <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate(false)}>
            <X /> {t('hr.a.reject')}
          </Button>
        </div>
      ) : (
        <StatusChip tone={c.status === 'APPROVED' ? 'ok' : c.status === 'REJECTED' ? 'bad' : 'warn'}>
          {t(`hr.cstatus.${c.status}`)}
        </StatusChip>
      )}
    </li>
  );
}

export function CorrectionsTab({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const q = useCorrections();
  const users = useUsers();
  const name = (id: string) => users.data?.find((u) => u.id === id)?.name;
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {q.data.toDecide.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.a.toDecide')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {q.data.toDecide.map((c) => (
                <CorrectionRow key={c.id} c={c} tz={tz} name={name(c.userId)} decide />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('hr.a.myCorrections')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.data.mine.length ? (
            <ul className="divide-y">
              {q.data.mine.map((c) => (
                <CorrectionRow key={c.id} c={c} tz={tz} />
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted-foreground">{t('hr.a.noCorrections')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Biometric device export: paste or pick the CSV (code, date-time, IN/OUT if the device gives it). */
export function ImportTab() {
  const { t } = useTranslation();
  const [csv, setCsv] = useState('');
  const run = useHrMutation(() => hrApi.importPunches(csv));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hr.a.importTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('hr.a.importHint')}</p>
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          aria-label={t('hr.a.pickFile')}
          className="text-sm"
          onChange={async (e) => setCsv(await (e.target.files?.[0]?.text() ?? Promise.resolve('')))}
        />
        <Textarea
          rows={6}
          className="font-mono text-xs"
          value={csv}
          placeholder="EMP-012,03/11/2026 09:02,IN"
          onChange={(e) => setCsv(e.target.value)}
        />
        <Button
          variant="primary"
          disabled={!csv.trim() || run.isPending}
          onClick={() => run.mutate(undefined)}
        >
          {run.isPending ? <Loader2 className="animate-spin" /> : <Upload />} {t('hr.a.import')}
        </Button>
        {run.data && (
          <p role="status" className="text-sm">
            {t('hr.a.imported', { added: run.data.added, skipped: run.data.skipped })}
            {run.data.unknownCodes.length > 0 &&
              ` · ${t('hr.a.unknown')}: ${run.data.unknownCodes.join(', ')}`}
            {run.data.badLines.length > 0 && ` · ${t('hr.a.badLines')}: ${run.data.badLines.join(', ')}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
