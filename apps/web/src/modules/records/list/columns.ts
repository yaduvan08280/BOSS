import type { TFunction } from 'i18next';
import type { FlowField, RecordDefinition } from '@mono/shared';
import { showValue } from '@/modules/fms/show';

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

/** A field's value as people read it (DD/MM/YYYY, ₹, Yes / No), or a dash. */
export function fieldText(f: FlowField | undefined, v: unknown, tz: string, t: TFunction): string {
  return showValue(f, v, tz, [t('common.yes'), t('common.no')]) ?? '—';
}
