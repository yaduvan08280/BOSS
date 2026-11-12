import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';
import { Checkbox } from '@/components/ui/form';
import { api } from '@/lib/api';
import type { ExtrasProps } from './types';

/** Values that have nothing a report could count, group or filter. */
const NOT_REPORTED = ['photo', 'file', 'signature', 'location'];

type Copying = { field: string; status: 'PENDING' | 'DONE'; copied: number; total: number };

/**
 * "Use in reports" (§2.7): the field keeps a typed, indexed copy of each record's value, so reports can filter,
 * group and total it. For a form that is already in use, older records are copied in the background — the line
 * under the tick says how far that is. Masters are lists, not records: no reports on them.
 */
export function ReportExtras({ field, onChange, owner }: ExtrasProps) {
  const { t } = useTranslation();
  const { id } = useParams();
  const { pathname } = useLocation();
  // The process builder does not hand its forms an owner: the process is the one in the address.
  const at =
    owner ?? (id && pathname.startsWith('/fms/builder/') ? ({ kind: 'flow', id } as const) : undefined);
  const applies = at?.kind !== 'master' && !NOT_REPORTED.includes(field.type);
  const state = useQuery({
    queryKey: ['reports', 'backfills', at?.kind, at?.id],
    queryFn: () => api<Copying[]>(`/api/reports/backfills?owner=${at!.kind}:${at!.id}`),
    enabled: applies && Boolean(at) && field.reportable === true,
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === 'PENDING') ? 5000 : false),
    retry: false,
  });
  if (!applies) return null;
  const copy = state.data?.find((c) => c.field === field.key);
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm sm:min-h-9">
        <Checkbox
          checked={field.reportable === true}
          onChange={(e) => onChange({ reportable: e.target.checked || undefined })}
        />
        <span className="font-medium">{t('forms.report.use')}</span>
      </label>
      {field.reportable && (
        <p className="pl-7 text-xs text-muted-foreground" aria-live="polite">
          {copy?.status === 'PENDING'
            ? t('forms.report.copying', { copied: copy.copied, total: copy.total })
            : copy
              ? t('forms.report.ready')
              : t('forms.report.afterSave')}
        </p>
      )}
    </div>
  );
}
