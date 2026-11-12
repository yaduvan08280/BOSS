import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FlowField } from '@mono/shared';
import { Select } from '@/components/ui/form';
import { keyFor } from '@/modules/fms/keys';
import { useRecordTypes } from '../api';

/**
 * "Link to another record type": adds a field that picks a record of that type (`rt:<id>`). One such field on
 * the record links to one record; one in a table of lines links to many.
 */
export function LinkAdder({
  typeId,
  fields,
  onAdd,
}: {
  typeId?: string;
  fields: FlowField[];
  onAdd: (f: FlowField) => void;
}) {
  const { t } = useTranslation();
  const types = (useRecordTypes().data?.types ?? []).filter((x) => x.status === 'ACTIVE');
  const linked = fields.filter((f) => f.type === 'master' && f.master?.startsWith('rt:'));
  if (!types.length) return null;
  return (
    <div className="rounded-control border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">{t('records.ed.linkTitle')}</span>
        <Select
          aria-label={t('records.ed.linkTitle')}
          className="min-w-44 flex-1 sm:max-w-64"
          value=""
          onChange={(e) => {
            const target = types.find((x) => x.id === e.target.value);
            if (!target) return;
            onAdd({
              key: keyFor(
                target.name,
                fields.map((f) => f.key),
              ),
              label: target.name,
              type: 'master',
              master: `rt:${target.id}`,
              required: false,
            });
          }}
        >
          <option value="">{t('records.ed.linkPick')}</option>
          {types.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id === typeId ? t('records.ed.linkSelf', { name: x.name }) : x.name}
            </option>
          ))}
        </Select>
      </div>
      {linked.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('records.ed.linked')}{' '}
          {linked
            .map((f) => `${f.label} → ${types.find((x) => `rt:${x.id}` === f.master)?.name ?? '?'}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
