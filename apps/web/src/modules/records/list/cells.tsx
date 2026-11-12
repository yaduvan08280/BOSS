import type { TFunction } from 'i18next';
import type { RecordDefinition } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { formatShortDateTime } from '@/lib/when';
import type { RecordRow } from '../api';
import { fieldText } from './columns';

/** A record's status as a chip: the fixed colour of its kind, its icon and its label (never colour alone). */
export function RecordStatusChip({ def, status }: { def: RecordDefinition; status: string }) {
  const s = def.statuses.find((x) => x.key === status);
  return <StatusChip tone={s?.kind ?? 'neutral'}>{s?.label ?? status}</StatusChip>;
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
