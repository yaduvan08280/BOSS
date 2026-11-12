import { ArrowLeft, Download, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import {
  blankReport,
  checkReport,
  hasPermission,
  REPORT_LOOKS,
  type Me,
  type ReportDefinition,
  type ReportSchedule,
} from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Confirm } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/modules/records/ui';
import { useRoles } from '@/modules/system/api';
import {
  reportsApi,
  sourceKey,
  usePreview,
  useReport,
  useReportFields,
  useReportSources,
  useReportsMutation,
  type ReportSource,
  type SavedReport,
} from './api';
import { Block, ColumnsPart, FiltersPart, GroupPart, MeasuresPart } from './BuilderParts';
import { ResultView } from './ResultView';
import { SchedulePart } from './SchedulePart';

/**
 * The report builder (plan §2.7): source → columns → filters → group → totals → look, with the result beside
 * it as it is built. A report someone else shared opens as its result only.
 */
export function ReportBuilderPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { id } = useParams();
  const saved = useReport(id);
  const sources = useReportSources();
  if (id && saved.isError) return <ErrorState onRetry={() => void saved.refetch()} />;
  if (sources.isPending || (id && saved.isPending)) return <PageSkeleton />;
  const first = sources.data?.[0];
  if (!id && !first)
    return (
      <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
        {t('reports.noSources')}
      </p>
    );
  // The builder starts from the saved report, or from a blank one on the first source (keyed, so opening
  // another report starts afresh).
  return (
    <Builder
      key={id ?? 'new'}
      me={me}
      saved={id ? saved.data! : null}
      sources={sources.data ?? []}
      start={id ? saved.data!.definition : blankReport({ kind: first!.kind, id: first!.id })}
    />
  );
}

function Builder({
  me,
  saved,
  sources,
  start,
}: {
  me: Me;
  saved: SavedReport | null;
  sources: ReportSource[];
  start: ReportDefinition;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roles = useRoles();
  const id = saved?.id;
  const [name, setName] = useState(saved?.name ?? '');
  const [def, setDef] = useState<ReportDefinition>(start);
  const [shared, setShared] = useState<string[]>(saved?.sharedRoles ?? []);
  const [schedule, setSchedule] = useState<ReportSchedule | null>(saved?.schedule ?? null);
  const [removing, setRemoving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const fields = useReportFields(def.source);
  const list = fields.data?.fields ?? [];
  const problems = fields.data ? checkReport(def, list) : [];
  const preview = usePreview(fields.data && !problems.length ? def : null);
  const canEdit = saved ? saved.canEdit : hasPermission(me.user.permissions, 'reports.create');
  const set = (patch: Partial<ReportDefinition>) => {
    setRefused(null);
    setDef((d) => ({ ...d, ...patch }));
  };
  const save = useReportsMutation(
    () => {
      const input = { name: name.trim(), definition: def, sharedRoles: shared, schedule };
      return id ? reportsApi.update(id, input) : reportsApi.create(input);
    },
    () => t('reports.saved', { name: name.trim() }),
  );
  const remove = useReportsMutation(
    () => reportsApi.remove(id!),
    () => t('reports.deleted'),
  );

  const result =
    preview.data && !problems.length ? <ResultView result={preview.data} look={def.look} /> : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/reports">
            <ArrowLeft /> {t('reports.title')}
          </Link>
        </Button>
        {canEdit ? (
          <Input
            aria-label={t('reports.name')}
            placeholder={t('reports.name')}
            className="min-w-0 flex-1 basis-56 text-base font-semibold"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{name}</h1>
        )}
        {id &&
          (['xlsx', 'pdf', 'csv'] as const).map((f) => (
            <Button key={f} asChild size="sm">
              <a href={reportsApi.exportUrl(id, f)} download>
                <Download /> {t(`reports.export.${f}`)}
              </a>
            </Button>
          ))}
        {canEdit && id && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('reports.delete')}
            onClick={() => setRemoving(true)}
          >
            <Trash2 />
          </Button>
        )}
        {canEdit && (
          <Button
            variant="primary"
            disabled={!name.trim() || problems.length > 0 || save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: (r) => !id && navigate(`/reports/${r.id}`, { replace: true }),
                onError: (e) => setRefused(e instanceof ApiError ? e.message : null),
              })
            }
          >
            {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
          </Button>
        )}
      </div>
      {refused && (
        <p role="alert" className="text-sm text-status-bad-fg">
          {refused}
        </p>
      )}
      {!canEdit ? (
        (result ??
        (preview.isError ? <ErrorState onRetry={() => void preview.refetch()} /> : <PageSkeleton />))
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="space-y-3">
            <Block title={t('reports.b.source')} hint={t('reports.b.sourceHint')}>
              <Select
                aria-label={t('reports.b.source')}
                value={sourceKey(def.source)}
                onChange={(e) => {
                  const next = sources.find((s) => sourceKey(s) === e.target.value);
                  if (next) setDef({ ...blankReport({ kind: next.kind, id: next.id }) });
                }}
              >
                {sources.map((s) => (
                  <option key={sourceKey(s)} value={sourceKey(s)}>
                    {t(`reports.kind.${s.kind}`)}: {s.name}
                  </option>
                ))}
              </Select>
              {fields.data && !list.some((f) => !f.builtin) && (
                <p className="text-xs text-muted-foreground">{t('reports.b.noReportable')}</p>
              )}
            </Block>
            <ColumnsPart def={def} fields={list} set={set} />
            <FiltersPart def={def} fields={list} set={set} />
            <GroupPart def={def} fields={list} set={set} />
            <MeasuresPart def={def} fields={list} set={set} />
            <Block title={t('reports.b.look')}>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('reports.b.look')}>
                {REPORT_LOOKS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={def.look === l}
                    disabled={l !== 'table' && !def.groupBy}
                    onClick={() => set({ look: l })}
                    className={cn(
                      'min-h-11 rounded-pill border px-3 text-sm disabled:opacity-50 md:min-h-9',
                      def.look === l ? 'border-primary bg-primary/15 font-medium' : 'bg-card',
                    )}
                  >
                    {t(`reports.look.${l}`)}
                  </button>
                ))}
              </div>
            </Block>
            <Block title={t('reports.b.share')} hint={t('reports.b.shareHint')}>
              <div className="flex flex-wrap gap-1.5">
                {(roles.data?.roles ?? []).map((r) => {
                  const on = shared.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setShared(on ? shared.filter((x) => x !== r.id) : [...shared, r.id])}
                      className={cn(
                        'min-h-11 rounded-pill border px-3 text-sm md:min-h-9',
                        on ? 'border-primary bg-primary/15 font-medium' : 'bg-card',
                      )}
                    >
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </Block>
            <SchedulePart schedule={schedule} onChange={setSchedule} me={me.user.id} />
          </div>
          <div className="min-w-0 space-y-3">
            {problems.length > 0 ? (
              <ul
                role="status"
                className="space-y-1 rounded-card border bg-card p-4 text-sm text-muted-foreground"
              >
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : preview.isError ? (
              <p role="alert" className="rounded-card border bg-card p-4 text-sm text-status-bad-fg">
                {preview.error instanceof ApiError ? preview.error.message : t('common.somethingWrong')}
              </p>
            ) : (
              (result ?? <PageSkeleton />)
            )}
          </div>
        </div>
      )}
      <Confirm
        open={removing}
        onOpenChange={setRemoving}
        title={t('reports.deleteTitle', { name })}
        body={t('reports.deleteBody')}
        confirm={t('reports.delete')}
        danger
        onConfirm={() =>
          remove.mutate(undefined, { onSuccess: () => navigate('/reports', { replace: true }) })
        }
      />
    </div>
  );
}
