import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, formatDateTime, formatLocalDate } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { useBranches, useDepartments } from '@/modules/system/api';
import { STATUS_TONE } from './api';
import {
  codeTone,
  hm,
  musterExport,
  useMuster,
  type MusterCell,
  type MusterFilter,
  type MusterPerson,
} from './musterApi';

const DAY = ['', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const clock = (iso: string | null, tz: string) => (iso ? formatDateTime(iso, tz).slice(-5) : '—');

/** HR → Attendance → Monthly report: the muster register and the daily punches, on screen and to download. */
export function MusterTab({ tz, today }: { tz: string; today: string }) {
  const { t, i18n } = useTranslation();
  const [f, setF] = useState<MusterFilter>({ month: today.slice(0, 7), departmentId: '', branchId: '' });
  const [view, setView] = useState<'muster' | 'punches'>('muster');
  // The last complete day: yesterday, unless today is the 1st.
  const lastDay = (month: string) =>
    month === today.slice(0, 7) ? (today.endsWith('-01') ? today : addDays(today, -1)) : `${month}-01`;
  const [day, setDay] = useState(lastDay(today.slice(0, 7)));
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<{ p: MusterPerson; c: MusterCell } | null>(null);
  const q = useMuster(f);
  const deps = useDepartments();
  const branches = useBranches();
  const [y, m] = f.month.split('-').map(Number) as [number, number];
  const shift = (by: number) => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    setF({ ...f, month });
    setDay(lastDay(month));
  };
  const people = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return (q.data?.people ?? []).filter((p) =>
      words.every((w) => [p.name, p.code, p.department, p.designation].join(' ').toLowerCase().includes(w)),
    );
  }, [q.data, search]);
  const sum = (k: keyof MusterPerson['totals']) => people.reduce((n, p) => n + p.totals[k], 0);
  const monthLabel = new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-control border bg-card px-1">
          <Button size="icon-sm" variant="ghost" aria-label={t('hr.a.prevMonth')} onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-32 text-center text-sm font-semibold">{monthLabel}</span>
          <Button size="icon-sm" variant="ghost" aria-label={t('hr.a.nextMonth')} onClick={() => shift(1)}>
            <ChevronRight />
          </Button>
        </div>
        <Select
          value={f.departmentId}
          onChange={(e) => setF({ ...f, departmentId: e.target.value })}
          className="h-10 w-auto"
          aria-label={t('muster.department')}
        >
          <option value="">{t('muster.allDepartments')}</option>
          {(deps.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        {(branches.data?.length ?? 0) > 1 && (
          <Select
            value={f.branchId}
            onChange={(e) => setF({ ...f, branchId: e.target.value })}
            className="h-10 w-auto"
            aria-label={t('muster.branch')}
          >
            <option value="">{t('muster.allBranches')}</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control border bg-card px-3 sm:max-w-xs max-sm:w-full max-sm:flex-none">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('muster.search')}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-control bg-muted p-1" role="tablist">
          {(['muster', 'punches'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'h-8 rounded-[calc(var(--radius)*0.5)] px-3 text-sm font-medium',
                view === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t(`muster.view.${v}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <a href={musterExport(f, 'muster', 'xlsx')}>
              <FileSpreadsheet /> {t('muster.dl.musterXlsx')}
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href={musterExport(f, 'muster', 'pdf')}>
              <FileText /> {t('muster.dl.musterPdf')}
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href={musterExport(f, 'punches', 'xlsx')}>
              <Download /> {t('muster.dl.punchesXlsx')}
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={musterExport(f, 'punches', 'csv')}>{t('muster.dl.csv')}</a>
          </Button>
        </div>
      </div>

      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : !people.length ? (
        <EmptyState icon={Users} title={t('muster.nobody')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile hero label={t('muster.kpi.people')} value={people.length} />
            <KpiTile label={t('muster.kpi.present')} value={sum('present')} unit={t('muster.days')} />
            <KpiTile
              label={t('muster.kpi.absent')}
              value={sum('absent')}
              unit={t('muster.days')}
              tone={sum('absent') ? 'bad' : undefined}
            />
            <KpiTile label={t('muster.kpi.late')} value={sum('late')} unit={t('muster.times')} />
            <KpiTile label={t('muster.kpi.leave')} value={sum('leave')} unit={t('muster.days')} />
            <KpiTile
              label={t('muster.kpi.overtime')}
              value={hm(sum('overtimeMin'))}
              unit={t('muster.hours')}
            />
          </div>
          {view === 'muster' ? (
            <MusterGrid people={people} days={q.data.days} onOpen={(p, c) => setOpen({ p, c })} />
          ) : (
            <DayPunches
              people={people}
              day={day}
              setDay={setDay}
              month={f.month}
              tz={tz}
              onOpen={(p, c) => setOpen({ p, c })}
            />
          )}
          <p className="text-xs text-muted-foreground">{t('muster.legend')}</p>
        </>
      )}
      {open && <DayDialog p={open.p} c={open.c} tz={tz} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MusterGrid({
  people,
  days,
  onOpen,
}: {
  people: MusterPerson[];
  days: { date: string; weekday: number }[];
  onOpen: (p: MusterPerson, c: MusterCell) => void;
}) {
  const { t } = useTranslation();
  const totals = ['present', 'late', 'halfDays', 'absent', 'leave', 'weeklyOffs', 'holidays'] as const;
  return (
    <div className="overflow-x-auto rounded-card border bg-card">
      <table className="min-w-max border-collapse text-xs tabular-nums">
        <thead>
          <tr className="border-b bg-muted/60 text-muted-foreground">
            <th className="sticky left-0 z-10 min-w-36 bg-card px-3 py-2 text-left font-medium sm:min-w-52">
              {t('muster.person')}
            </th>
            {days.map((d) => (
              <th
                key={d.date}
                className={cn('w-8 px-0.5 py-1 text-center font-medium', d.weekday === 7 && 'bg-muted')}
              >
                <div>{Number(d.date.slice(8))}</div>
                <div className="text-[10px] font-normal">{DAY[d.weekday]}</div>
              </th>
            ))}
            {totals.map((k) => (
              <th key={k} className="w-10 px-1 text-center font-semibold" title={t(`muster.total.${k}`)}>
                {t(`muster.short.${k}`)}
              </th>
            ))}
            <th className="w-14 px-2 text-center font-semibold">{t('muster.short.hours')}</th>
            <th className="w-12 px-2 text-center font-semibold">{t('muster.short.ot')}</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} className="border-b last:border-0">
              <td className="sticky left-0 z-10 max-w-52 bg-card px-3 py-1.5">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {[p.code, p.department].filter(Boolean).join(' · ')}
                </div>
              </td>
              {p.cells.map((c) => (
                <td key={c.date} className="px-0.5 py-1 text-center">
                  {c.blank ? (
                    <span className="text-muted-foreground/40">·</span>
                  ) : (
                    <button
                      onClick={() => onOpen(p, c)}
                      title={c.date}
                      className={cn(
                        'h-7 w-8 rounded-[6px] text-[11px] font-semibold hover:ring-2 hover:ring-ring',
                        codeTone(c),
                        c.live && 'ring-1 ring-dashed ring-muted-foreground',
                      )}
                    >
                      {c.code || '…'}
                    </button>
                  )}
                </td>
              ))}
              {totals.map((k) => (
                <td
                  key={k}
                  className={cn(
                    'text-center font-semibold',
                    k === 'absent' && p.totals.absent && 'text-status-bad',
                  )}
                >
                  {p.totals[k] || '—'}
                </td>
              ))}
              <td className="text-center">{hm(p.totals.workedMin)}</td>
              <td className="text-center">{hm(p.totals.overtimeMin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayPunches({
  people,
  day,
  setDay,
  month,
  tz,
  onOpen,
}: {
  people: MusterPerson[];
  day: string;
  setDay: (d: string) => void;
  month: string;
  tz: string;
  onOpen: (p: MusterPerson, c: MusterCell) => void;
}) {
  const { t } = useTranslation();
  const inMonth = (d: string) => d.startsWith(month);
  const rows = people
    .map((p) => ({ p, c: p.cells.find((c) => c.date === day) }))
    .filter((r): r is { p: MusterPerson; c: MusterCell } => Boolean(r.c && !r.c.blank));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label={t('muster.prevDay')}
          disabled={!inMonth(addDays(day, -1))}
          onClick={() => setDay(addDays(day, -1))}
        >
          <ChevronLeft />
        </Button>
        <DateInput
          value={day}
          onChange={(v) => v && inMonth(v) && setDay(v)}
          className="w-44"
          aria-label={t('muster.day')}
        />
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label={t('muster.nextDay')}
          disabled={!inMonth(addDays(day, 1))}
          onClick={() => setDay(addDays(day, 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      {!rows.length ? (
        <EmptyState icon={Users} title={t('muster.noDay', { date: formatLocalDate(day) })} />
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {rows.map(({ p, c }) => (
            <li key={p.id}>
              <button
                onClick={() => onOpen(p, c)}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-muted/40 sm:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.6fr))_auto]"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[p.code, p.department, p.shift].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="tabular-nums">
                  {c.inAt
                    ? `${clock(c.inAt, tz)} – ${c.missedOut ? t('muster.noOut') : clock(c.outAt, tz)}`
                    : '—'}
                </div>
                <div className="col-span-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground sm:col-span-1 sm:block">
                  <span>
                    {t('muster.worked')} {hm(c.workedMin)}
                  </span>
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  {t('muster.late')} {c.lateMin ? `${c.lateMin}m` : '—'}
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  {t('muster.ot')} {hm(c.overtimeMin)}
                </div>
                <div className="col-start-2 row-start-1 justify-self-end sm:col-start-auto sm:row-start-auto">
                  {c.status ? (
                    <StatusChip tone={STATUS_TONE[c.status]}>{c.code}</StatusChip>
                  ) : (
                    <span className="text-xs text-muted-foreground">{c.live ? t('muster.notIn') : '–'}</span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DayDialog({
  p,
  c,
  tz,
  onClose,
}: {
  p: MusterPerson;
  c: MusterCell;
  tz: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={p.name}
      description={`${formatLocalDate(c.date)} · ${p.shift}`}
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {c.status && <StatusChip tone={STATUS_TONE[c.status]}>{t(`hr.status.${c.status}`)}</StatusChip>}
          <span className="font-semibold">{c.code}</span>
          {c.live && <span className="text-xs text-muted-foreground">{t('muster.live')}</span>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
          <dt className="text-muted-foreground">{t('muster.in')}</dt>
          <dd>{clock(c.inAt, tz)}</dd>
          <dt className="text-muted-foreground">{t('muster.out')}</dt>
          <dd>{c.missedOut ? t('muster.noOut') : clock(c.outAt, tz)}</dd>
          <dt className="text-muted-foreground">{t('muster.worked')}</dt>
          <dd>{hm(c.workedMin)}</dd>
          <dt className="text-muted-foreground">{t('muster.late')}</dt>
          <dd>{c.lateMin ? `${c.lateMin} min` : '—'}</dd>
          <dt className="text-muted-foreground">{t('muster.ot')}</dt>
          <dd>{hm(c.overtimeMin)}</dd>
        </dl>
        {c.punches.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t('muster.punches')}</div>
            <ul className="space-y-1">
              {c.punches.map((x) => (
                <li key={x.at + x.type} className="flex items-center gap-2 tabular-nums">
                  <span className="w-12">{clock(x.at, tz)}</span>
                  <span className="font-medium">{x.type}</span>
                  {x.source !== 'app' && <span className="text-xs text-muted-foreground">{x.source}</span>}
                  {x.flagged && <span className="text-xs text-status-warn-fg">{t('muster.flagged')}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {c.reasons.length > 0 && <p className="text-xs text-muted-foreground">{c.reasons.join(' · ')}</p>}
      </div>
    </Dialog>
  );
}
