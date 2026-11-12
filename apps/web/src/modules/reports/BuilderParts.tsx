import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  REPORT_BUCKETS,
  REPORT_FNS,
  reportOpsFor,
  type ReportDefinition,
  type ReportField,
  type ReportFilter,
  type ReportMeasure,
} from '@mono/shared';
import { Button } from '@/modules/records/ui';
import { DateInput } from '@/components/ui/date-input';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type PartProps = {
  def: ReportDefinition;
  fields: ReportField[];
  set: (patch: Partial<ReportDefinition>) => void;
};

const NO_VALUE = ['this_week', 'this_month', 'this_fy', 'filled', 'empty'];

/** A titled block of the builder (Columns, Filters, Group, Totals, Look). */
export function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-card border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Columns of the plain list: tap to add or take off, in the order tapped. */
export function ColumnsPart({ def, fields, set }: PartProps) {
  const { t } = useTranslation();
  const toggle = (key: string) =>
    set({
      columns: def.columns.includes(key) ? def.columns.filter((c) => c !== key) : [...def.columns, key],
    });
  return (
    <Block
      title={t('reports.b.columns')}
      hint={def.groupBy ? t('reports.b.columnsGrouped') : t('reports.b.columnsHint')}
    >
      <div className="flex flex-wrap gap-1.5">
        {fields.map((f) => {
          const on = def.columns.includes(f.key);
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              disabled={Boolean(def.groupBy) || (!on && def.columns.length >= 12)}
              onClick={() => toggle(f.key)}
              className={cn(
                'min-h-11 rounded-pill border px-3 text-sm disabled:opacity-50 md:min-h-9',
                on ? 'border-primary bg-primary/15 font-medium' : 'bg-card',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </Block>
  );
}

export function FiltersPart({ def, fields, set }: PartProps) {
  const { t } = useTranslation();
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const setFilter = (i: number, patch: Partial<ReportFilter>) =>
    set({ filters: def.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <Block title={t('reports.b.filters')} hint={t('reports.b.filtersHint')}>
      {def.filters.map((f, i) => {
        const field = byKey.get(f.field);
        const kind = field?.kind ?? 'text';
        const ops = reportOpsFor(kind);
        const value = (which: 'value' | 'value2', label: string) =>
          kind === 'date' && f.op !== 'last_days' ? (
            <DateInput
              aria-label={label}
              value={f[which] ?? ''}
              onChange={(iso) => setFilter(i, { [which]: iso })}
            />
          ) : (
            <Input
              aria-label={label}
              inputMode={kind === 'number' || f.op === 'last_days' ? 'decimal' : 'text'}
              placeholder={f.op === 'last_days' ? t('reports.b.days') : label}
              value={f[which] ?? ''}
              onChange={(e) => setFilter(i, { [which]: e.target.value })}
            />
          );
        return (
          <div
            key={i}
            className="grid grid-cols-1 gap-2 rounded-control border p-2 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-start"
          >
            <Select
              aria-label={t('reports.b.filterField')}
              value={f.field}
              onChange={(e) => {
                const next = byKey.get(e.target.value)!;
                setFilter(i, {
                  field: next.key,
                  op: reportOpsFor(next.kind)[0]!,
                  value: undefined,
                  value2: undefined,
                });
              }}
            >
              {fields.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('reports.b.filterOp')}
              value={f.op}
              onChange={(e) =>
                setFilter(i, {
                  op: e.target.value as ReportFilter['op'],
                  value: undefined,
                  value2: undefined,
                })
              }
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {t(`reports.op.${op}`)}
                </option>
              ))}
            </Select>
            {NO_VALUE.includes(f.op) ? (
              <span className="hidden sm:block" />
            ) : (
              <div className={cn('grid gap-2', f.op === 'between' && 'grid-cols-2')}>
                {value('value', f.op === 'between' ? t('reports.b.from') : t('reports.b.value'))}
                {f.op === 'between' && value('value2', t('reports.b.to'))}
              </div>
            )}
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('reports.b.removeFilter')}
              onClick={() => set({ filters: def.filters.filter((_, j) => j !== i) })}
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <Button
        size="sm"
        disabled={!fields.length || def.filters.length >= 10}
        onClick={() => {
          const first = fields[0]!;
          set({ filters: [...def.filters, { field: first.key, op: reportOpsFor(first.kind)[0]! }] });
        }}
      >
        <Plus /> {t('reports.b.addFilter')}
      </Button>
    </Block>
  );
}

export function GroupPart({ def, fields, set }: PartProps) {
  const { t } = useTranslation();
  const field = fields.find((f) => f.key === def.groupBy?.field);
  return (
    <Block title={t('reports.b.group')} hint={t('reports.b.groupHint')}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select
          aria-label={t('reports.b.groupField')}
          value={def.groupBy?.field ?? ''}
          onChange={(e) => {
            const next = fields.find((f) => f.key === e.target.value);
            if (!next) return set({ groupBy: undefined, look: 'table' });
            set({
              groupBy: { field: next.key, ...(next.kind === 'date' ? { bucket: 'month' as const } : {}) },
              measures: def.measures.length ? def.measures : [{ fn: 'count' }],
            });
          }}
        >
          <option value="">{t('reports.b.noGroup')}</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
        {field?.kind === 'date' && (
          <Select
            aria-label={t('reports.b.bucket')}
            value={def.groupBy?.bucket ?? 'day'}
            onChange={(e) =>
              set({
                groupBy: { field: field.key, bucket: e.target.value as (typeof REPORT_BUCKETS)[number] },
              })
            }
          >
            {REPORT_BUCKETS.map((b) => (
              <option key={b} value={b}>
                {t(`reports.bucket.${b}`)}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Block>
  );
}

export function MeasuresPart({ def, fields, set }: PartProps) {
  const { t } = useTranslation();
  const numbers = fields.filter((f) => f.kind === 'number');
  const setMeasure = (i: number, patch: Partial<ReportMeasure>) =>
    set({ measures: def.measures.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  return (
    <Block title={t('reports.b.totals')} hint={t('reports.b.totalsHint')}>
      {def.measures.map((m, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Select
            aria-label={t('reports.b.totalFn')}
            value={m.fn}
            onChange={(e) => {
              const fn = e.target.value as ReportMeasure['fn'];
              setMeasure(
                i,
                fn === 'count' ? { fn, field: undefined } : { fn, field: m.field ?? numbers[0]?.key },
              );
            }}
          >
            {REPORT_FNS.filter((fn) => fn === 'count' || numbers.length > 0).map((fn) => (
              <option key={fn} value={fn}>
                {t(`reports.fn.${fn}`)}
              </option>
            ))}
          </Select>
          {m.fn === 'count' ? (
            <span />
          ) : (
            <Select
              aria-label={t('reports.b.totalField')}
              value={m.field ?? ''}
              onChange={(e) => setMeasure(i, { field: e.target.value })}
            >
              {numbers.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('reports.b.removeTotal')}
            onClick={() => set({ measures: def.measures.filter((_, j) => j !== i) })}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        disabled={def.measures.length >= 6}
        onClick={() => set({ measures: [...def.measures, { fn: 'count' }] })}
      >
        <Plus /> {t('reports.b.addTotal')}
      </Button>
    </Block>
  );
}
