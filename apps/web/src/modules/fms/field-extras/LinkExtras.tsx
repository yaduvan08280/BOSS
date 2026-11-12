import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parseSource, type FlowField } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useSourceColumns, type SourceColumn } from '@/modules/masters/api';
import { useFlow } from '../api';
import type { ExtrasProps } from './types';

const UNIQUE_TYPES = ['text', 'number', 'date', 'master'];
const row = 'flex min-h-9 items-center gap-2 text-xs';

/** Linked choices (§2.2–2.3): records to offer, unique, auto-fill, locked, depends on another field. */
export function LinkExtras({ field, fields, onChange }: ExtrasProps) {
  const { t } = useTranslation();
  const source = field.type === 'master' ? (field.master ?? 'customers') : undefined;
  const parsed = parseSource(source);
  const columns = useSourceColumns(parsed && parsed.kind !== 'fms' ? source : undefined).data ?? [];
  const others = fields.filter((f) => f.key !== field.key && f.type !== 'formula');
  const filledBy = fields.find((f) => f.key !== field.key && f.fill && field.key in f.fill);
  const canBeUnique = UNIQUE_TYPES.includes(field.type);
  if (!source && !filledBy && !canBeUnique) return null;
  // Built-in lists come with English column names: show them in the person's language.
  const label = (c: SourceColumn) => t(`links.col.${c.key}`, { defaultValue: c.label });
  return (
    <div className="space-y-2 rounded-control bg-muted/40 p-2.5">
      {parsed?.kind === 'rec' && <RecordsToOffer field={field} onChange={onChange} flowId={parsed.flowId} />}
      {columns.length > 0 && others.length > 0 && (
        <FillMap field={field} others={others} columns={columns} label={label} onChange={onChange} />
      )}
      {columns.length > 0 && others.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium">{t('links.e.depends')}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select
              aria-label={t('links.e.depends')}
              value={field.filterBy?.field ?? ''}
              onChange={(e) =>
                onChange({
                  filterBy: e.target.value
                    ? { field: e.target.value, column: field.filterBy?.column ?? columns[0]!.key }
                    : undefined,
                })
              }
            >
              <option value="">{t('links.e.dependsNone')}</option>
              {others.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
            {field.filterBy && (
              <Select
                aria-label={t('links.e.dependsColumn')}
                value={field.filterBy.column}
                onChange={(e) => onChange({ filterBy: { ...field.filterBy!, column: e.target.value } })}
              >
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {t('links.e.dependsOn', { column: label(c) })}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>
      )}
      {filledBy && (
        <label className={row}>
          <Checkbox
            checked={Boolean(field.locked)}
            onChange={(e) => onChange({ locked: e.target.checked || undefined })}
          />
          {t('links.e.locked', { field: filledBy.label })}
        </label>
      )}
      {canBeUnique && (
        <label className={row}>
          <Checkbox
            checked={Boolean(field.unique)}
            onChange={(e) => onChange({ unique: e.target.checked || undefined })}
          />
          {t('links.e.unique')}
        </label>
      )}
    </div>
  );
}

/** `rec:` only — which records of the other process are offered. */
function RecordsToOffer({
  field,
  onChange,
  flowId,
}: Pick<ExtrasProps, 'field' | 'onChange'> & { flowId: string }) {
  const { t } = useTranslation();
  const steps = useFlow(flowId || undefined).data?.definition.steps ?? [];
  const f = field.recFilter ?? {};
  const set = (patch: NonNullable<FlowField['recFilter']>) => {
    const next = Object.fromEntries(Object.entries({ ...f, ...patch }).filter(([, v]) => v));
    onChange({ recFilter: Object.keys(next).length ? next : undefined });
  };
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium">{t('links.e.records')}</legend>
      <label className={row}>
        <Checkbox checked={Boolean(f.running)} onChange={(e) => set({ running: e.target.checked })} />
        {t('links.e.running')}
      </label>
      <label className={row}>
        <Checkbox checked={Boolean(f.mine)} onChange={(e) => set({ mine: e.target.checked })} />
        {t('links.e.mine')}
      </label>
      <div className={row}>
        <Checkbox
          aria-label={t('links.e.days')}
          checked={Boolean(f.days)}
          onChange={(e) => set({ days: e.target.checked ? 30 : undefined })}
        />
        <span>{t('links.e.days')}</span>
        <Input
          aria-label={t('links.e.daysCount')}
          inputMode="numeric"
          className="h-9 w-20 sm:h-8"
          value={f.days ?? ''}
          onChange={(e) => {
            const n = Math.min(3650, Math.floor(Number(e.target.value)));
            set({ days: n >= 1 ? n : undefined });
          }}
        />
        <span>{t('links.e.daysUnit')}</span>
      </div>
      <Select
        aria-label={t('links.e.step')}
        value={f.step ?? ''}
        onChange={(e) => set({ step: e.target.value })}
      >
        <option value="">{t('links.e.anyStep')}</option>
        {steps.map((s) => (
          <option key={s.key} value={s.key}>
            {t('links.e.atStep', { step: s.name })}
          </option>
        ))}
      </Select>
    </fieldset>
  );
}

/** Auto-fill: a column of the picked row → another field of this form. */
function FillMap({
  field,
  others,
  columns,
  label,
  onChange,
}: Pick<ExtrasProps, 'field' | 'onChange'> & {
  others: FlowField[];
  columns: SourceColumn[];
  label: (c: SourceColumn) => string;
}) {
  const { t } = useTranslation();
  const pairs = Object.entries(field.fill ?? {});
  const save = (next: [string, string][]) =>
    onChange({ fill: next.length ? Object.fromEntries(next) : undefined });
  const free = others.filter((o) => !pairs.some(([k]) => k === o.key));
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{t('links.e.fill')}</div>
      {pairs.map(([target, column], i) => (
        <div key={target} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
          <Select
            aria-label={t('links.e.fillColumn')}
            value={column}
            onChange={(e) => save(pairs.map((p, j) => (j === i ? [target, e.target.value] : p)))}
          >
            {columns.map((c) => (
              <option key={c.key} value={c.key}>
                {label(c)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('links.e.fillInto')}
            value={target}
            onChange={(e) => save(pairs.map((p, j) => (j === i ? [e.target.value, column] : p)))}
          >
            {others
              .filter((o) => o.key === target || free.includes(o))
              .map((o) => (
                <option key={o.key} value={o.key}>
                  → {o.label}
                </option>
              ))}
          </Select>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('common.remove')}
            onClick={() => save(pairs.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      {free.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            // The column of the same name when there is one (unit → Unit), else the first.
            const to = free.find((o) => columns.some((c) => c.key === o.key)) ?? free[0]!;
            save([...pairs, [to.key, (columns.find((c) => c.key === to.key) ?? columns[0]!).key]]);
          }}
        >
          <Plus /> {t('links.e.fillAdd')}
        </Button>
      )}
    </div>
  );
}
