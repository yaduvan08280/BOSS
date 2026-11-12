import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  filterOpsFor,
  listable,
  type FlowField,
  type RecordDefinition,
  type RecordFilter,
  type RecordFilterOp,
} from '@mono/shared';
import { Button } from '@/modules/records/ui';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { ListParams } from '../api';
import { columnLabel } from './columns';

const NO_VALUE: RecordFilterOp[] = ['filled', 'empty'];

/** The words for a filter: dates say "on or after", numbers "at least". */
function opLabel(f: FlowField, op: RecordFilterOp, t: TFunction): string {
  const date = f.type === 'date' || f.type === 'datetime';
  switch (op) {
    case 'eq':
      return t('records.filter.eq');
    case 'contains':
      return t('records.filter.contains');
    case 'gte':
      return date ? t('records.filter.fromDate') : t('records.filter.gte');
    case 'lte':
      return date ? t('records.filter.toDate') : t('records.filter.lte');
    case 'filled':
      return t('records.filter.filled');
    default:
      return t('records.filter.empty');
  }
}

function ValueInput({ f, value, onChange }: { f: FlowField; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const label = t('records.filter.value');
  if (f.type === 'date' || f.type === 'datetime')
    return <DateInput aria-label={label} value={value} onChange={onChange} />;
  if (f.type === 'yesno' || (f.type === 'dropdown' && f.options?.length))
    return (
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('org.choose')}</option>
        {f.type === 'yesno' ? (
          <>
            <option value="yes">{t('common.yes')}</option>
            <option value="no">{t('common.no')}</option>
          </>
        ) : (
          f.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))
        )}
      </Select>
    );
  return (
    <Input
      aria-label={label}
      placeholder={label}
      value={value}
      inputMode={['number', 'amount', 'formula'].includes(f.type) ? 'decimal' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Filter the list by when a record was made and by any field's value; choose the sort (for phones too). */
export function FiltersDialog({
  def,
  params,
  onApply,
  onClose,
}: {
  def: RecordDefinition;
  params: ListParams;
  onApply: (p: Pick<ListParams, 'from' | 'to' | 'filters' | 'sort' | 'dir'>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fields = def.fields.filter(listable);
  const [from, setFrom] = useState(params.from ?? '');
  const [to, setTo] = useState(params.to ?? '');
  const [filters, setFilters] = useState<RecordFilter[]>(params.filters ?? []);
  const [sort, setSort] = useState(params.sort ?? '');
  const [dir, setDir] = useState(params.dir ?? 'desc');
  const set = (i: number, p: Partial<RecordFilter>) =>
    setFilters(filters.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const ready = filters.every((f) => NO_VALUE.includes(f.op) || f.value?.trim());
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={t('records.filter.title')}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => (
              onApply({
                from: undefined,
                to: undefined,
                filters: undefined,
                sort: undefined,
                dir: undefined,
              }),
              onClose()
            )}
          >
            {t('records.filter.clear')}
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              onApply({
                from: from || undefined,
                to: to || undefined,
                filters: filters.length ? filters : undefined,
                sort: sort || undefined,
                dir: sort ? dir : undefined,
              });
              onClose();
            }}
          >
            {t('records.list.apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-5 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('records.filter.madeFrom')}>
            <DateInput value={from} onChange={setFrom} max={to || undefined} />
          </Field>
          <Field label={t('records.filter.madeTo')}>
            <DateInput value={to} onChange={setTo} min={from || undefined} />
          </Field>
        </div>
        <div className="space-y-2">
          <span className="text-sm font-medium">{t('records.filter.byField')}</span>
          {filters.map((filter, i) => {
            const f = fields.find((x) => x.key === filter.field) ?? fields[0]!;
            return (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto] gap-2 rounded-control border bg-card p-2.5 sm:grid-cols-[1fr_150px_1fr_auto]"
              >
                <Select
                  aria-label={t('records.filter.field')}
                  value={f.key}
                  onChange={(e) => {
                    const next = fields.find((x) => x.key === e.target.value)!;
                    set(i, { field: next.key, op: filterOpsFor(next)[0]!, value: '' });
                  }}
                >
                  {fields.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  className="sm:order-last"
                  aria-label={t('records.filter.remove')}
                  onClick={() => setFilters(filters.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
                <Select
                  aria-label={t('records.filter.how')}
                  value={filter.op}
                  onChange={(e) => set(i, { op: e.target.value as RecordFilterOp })}
                >
                  {filterOpsFor(f).map((op) => (
                    <option key={op} value={op}>
                      {opLabel(f, op, t)}
                    </option>
                  ))}
                </Select>
                {!NO_VALUE.includes(filter.op) && (
                  <div className="col-span-2 sm:col-span-1">
                    <ValueInput f={f} value={filter.value ?? ''} onChange={(value) => set(i, { value })} />
                  </div>
                )}
              </div>
            );
          })}
          <Button
            size="sm"
            disabled={!fields.length || filters.length >= 10}
            onClick={() =>
              setFilters([...filters, { field: fields[0]!.key, op: filterOpsFor(fields[0]!)[0]!, value: '' }])
            }
          >
            <Plus /> {t('records.filter.add')}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('records.filter.sortBy')}>
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="">{t('records.filter.sortNewest')}</option>
              {['code', 'title', 'status', ...fields.map((x) => x.key)].map((c) => (
                <option key={c} value={c}>
                  {columnLabel(def, c, t)}
                </option>
              ))}
            </Select>
          </Field>
          {sort && (
            <Field label={t('records.filter.order')}>
              <Select value={dir} onChange={(e) => setDir(e.target.value as 'asc' | 'desc')}>
                <option value="asc">{t('records.filter.asc')}</option>
                <option value="desc">{t('records.filter.desc')}</option>
              </Select>
            </Field>
          )}
        </div>
      </div>
    </Dialog>
  );
}
