import type { TFunction } from 'i18next';
import type { FlowField, RecordDefinition } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { formatShortDateTime } from '@/lib/when';
import { showValue } from '@/modules/fms/show';
import type { RecordRow } from '../api';

export const BUILTIN = ['code', 'title', 'status', 'createdAt', 'createdBy'] as const;

/** A column's heading: the field's own label, or the words for a built-in column. */
export function columnLabel(def: RecordDefinition, key: string, t: TFunction): string {
  const f = def.fields.find((x) => x.key === key);
  if (f) return f.label;
  switch (key) {
    case 'code':
      return t('records.col.code');
    case 'title':
      return t('records.col.title');
    case 'status':
      return t('records.col.status');
    case 'createdAt':
      return t('records.col.createdAt');
    case 'createdBy':
      return t('records.col.createdBy');
    default:
      return key;
  }
}

/** A record's status as a chip: the fixed colour of its kind, its icon and its label (never colour alone). */
export function RecordStatusChip({ def, status }: { def: RecordDefinition; status: string }) {
  const s = def.statuses.find((x) => x.key === status);
  return <StatusChip tone={s?.kind ?? 'neutral'}>{s?.label ?? status}</StatusChip>;
}

/** A field's value as people read it (DD/MM/YYYY, ₹, Yes / No), or a dash. */
export function fieldText(f: FlowField | undefined, v: unknown, tz: string, t: TFunction): string {
  return showValue(f, v, tz, [t('common.yes'), t('common.no')]) ?? '—';
}

export function RecordCell({
  def,
  column,
  row,
  tz,
  t,
}: {
  def: RecordDefinition;
  column: string;
  row: RecordRow;
  tz: string;
  t: TFunction;
}) {
  switch (column) {
    case 'code':
      return <span className="whitespace-nowrap font-mono text-xs">{row.code}</span>;
    case 'title':
      return <span className="font-medium">{row.title}</span>;
    case 'status':
      return <RecordStatusChip def={def} status={row.status} />;
    case 'createdAt':
      return <span className="tabular whitespace-nowrap">{formatShortDateTime(row.createdAt, tz)}</span>;
    case 'createdBy':
      return <>{row.createdBy ?? '—'}</>;
    default: {
      const f = def.fields.find((x) => x.key === column);
      const numeric = f && ['number', 'amount', 'formula'].includes(f.type);
      return <span className={numeric ? 'tabular' : undefined}>{fieldText(f, row.data[column], tz, t)}</span>;
    }
  }
}
