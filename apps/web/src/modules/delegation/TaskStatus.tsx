import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/status-chip';
import { formatShortDateTime } from '@/lib/when';
import type { TaskRow } from './api';

/** Status chips: Awaiting acceptance / Accepted dd/mm hh:mm / Verifier: name / Covered by … */
export function TaskStatusChips({
  t: task,
  names,
  tz,
}: {
  t: Pick<TaskRow, 'status' | 'acceptedAt' | 'verifierId' | 'coveredById' | 'plannedAt' | 'doneAt'>;
  names: Map<string, string>;
  tz: string;
}) {
  const { t } = useTranslation();
  const late = !task.doneAt && new Date(task.plannedAt) < new Date();
  return (
    <div className="flex flex-wrap gap-1">
      {task.status === 'AWAITING_ACCEPTANCE' && (
        <StatusChip tone="neutral">{t('task.status.AWAITING_ACCEPTANCE')}</StatusChip>
      )}
      {task.status === 'OPEN' &&
        (late ? (
          <StatusChip tone="bad">{t('task.overdue')}</StatusChip>
        ) : (
          <StatusChip tone="info">
            {task.acceptedAt
              ? t('task.acceptedAt', { at: formatShortDateTime(task.acceptedAt, tz) })
              : t('task.status.OPEN')}
          </StatusChip>
        ))}
      {task.status === 'PENDING_VERIFY' && (
        <StatusChip tone="warn">{t('task.status.PENDING_VERIFY')}</StatusChip>
      )}
      {task.status === 'DONE' && <StatusChip tone="ok">{t('task.status.DONE')}</StatusChip>}
      {task.status === 'RETURNED_TO_CREATOR' && (
        <StatusChip tone="bad">{t('task.status.RETURNED_TO_CREATOR')}</StatusChip>
      )}
      {task.status === 'CANCELLED' && <StatusChip tone="neutral">{t('task.status.CANCELLED')}</StatusChip>}
      {task.verifierId && task.status !== 'DONE' && (
        <span className="rounded-pill bg-muted px-2 py-0.5 text-[11px] font-medium">
          {t('task.verifierIs', { name: names.get(task.verifierId) ?? '?' })}
        </span>
      )}
      {task.coveredById && (
        <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-soft-foreground">
          {t('task.coveredBy', { name: names.get(task.coveredById) ?? '?' })}
        </span>
      )}
    </div>
  );
}
