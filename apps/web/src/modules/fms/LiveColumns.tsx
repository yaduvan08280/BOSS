import { Columns3, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PageSkeleton } from '@/components/page';
import { matchScore } from '@/lib/pick';
import { useWorkMutation } from '@/lib/work';
import { api } from '@/lib/api';
import { useFlowPaths } from './api';

export const MAX_LIVE_COLUMNS = 6;

/** The values a row shows besides the fixed ones, as "Label: value" pieces that wrap (works at any width). */
export function ExtraValues({
  columns,
  cols,
}: {
  columns: { path: string; label: string }[];
  cols: Record<string, string> | undefined;
}) {
  const shown = columns.filter((c) => cols?.[c.path]);
  if (!shown.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {shown.map((c) => (
        <span key={c.path} className="min-w-0 break-words">
          <span className="text-muted-foreground">{c.label}: </span>
          <span className="tabular font-medium">{cols![c.path]}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * "Columns" for a process's Live FMS list (plan §2.5): any value of the process — a field, a remembered or
 * worked-out value, or a column of the row a field links to ("Customer → City"). Up to six; saved for everyone.
 */
export function LiveColumnsButton({ flowId, chosen }: { flowId: string; chosen: string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Columns3 /> <span className="hidden sm:inline">{t('show.columns')}</span>
        <span className="sr-only sm:hidden">{t('show.columns')}</span>
      </Button>
      {open && <ColumnsDialog flowId={flowId} chosen={chosen} onClose={() => setOpen(false)} />}
    </>
  );
}

function ColumnsDialog({
  flowId,
  chosen,
  onClose,
}: {
  flowId: string;
  chosen: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const paths = useFlowPaths(flowId);
  const [picked, setPicked] = useState<string[]>(chosen);
  const [filter, setFilter] = useState('');
  const save = useWorkMutation(
    () => api(`/api/fms/flows/${flowId}/live-columns`, { method: 'PUT', body: { columns: picked } }),
    [['fms', 'live']],
    () => t('show.saved'),
  );
  const offered = (paths.data ?? []).filter((p) => p.shown);
  const shown = offered.filter((p) => !filter.trim() || matchScore(filter, `${p.label} ${p.group}`) > 0);
  const groups = [...new Set(shown.map((p) => p.group))];
  const full = picked.length >= MAX_LIVE_COLUMNS;
  const toggle = (path: string) =>
    setPicked((now) => (now.includes(path) ? now.filter((p) => p !== path) : full ? now : [...now, path]));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('show.columnsTitle')}
      description={t('show.columnsBody', { max: MAX_LIVE_COLUMNS })}
      footer={
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('show.save')}
        </Button>
      }
    >
      {!paths.data ? (
        <PageSkeleton />
      ) : !offered.length ? (
        <p className="text-sm text-muted-foreground">{t('show.none')}</p>
      ) : (
        <div className="space-y-3">
          <Input
            aria-label={t('show.search')}
            placeholder={t('show.search')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t('show.count', { n: picked.length, max: MAX_LIVE_COLUMNS })}
          </p>
          {groups.map((g) => (
            <fieldset key={g} className="space-y-1">
              <legend className="text-xs font-semibold text-muted-foreground">
                {g === 'Start form' ? t('fms.b.startForm') : g}
              </legend>
              {shown
                .filter((p) => p.group === g)
                .map((p) => {
                  const on = picked.includes(p.path);
                  return (
                    <label key={p.path} className="flex min-h-11 items-center gap-2 text-sm">
                      <Checkbox checked={on} disabled={!on && full} onChange={() => toggle(p.path)} />
                      {p.label}
                    </label>
                  );
                })}
            </fieldset>
          ))}
          {!shown.length && <p className="text-sm text-muted-foreground">{t('show.noMatch')}</p>}
        </div>
      )}
    </Dialog>
  );
}
