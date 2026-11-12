import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Move = {
  id: string;
  stepId: string | null;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUST';
  status: 'APPLIED' | 'PENDING' | 'REJECTED';
  qty: number;
  item: { code: string; name: string; unit: string };
  fromLocation: string | null;
  toLocation: string | null;
  reversal: boolean;
  reversed: 'APPLIED' | 'PENDING' | 'REJECTED' | null;
};

/** What one step of a record did to stock: moved, waiting for an approver, not issued, reversed (L15–L17). */
export function RecordStock({ recordId, stepId }: { recordId: string; stepId: string }) {
  const { t } = useTranslation();
  // One request per record: every step of the drawer reads the same answer.
  const q = useQuery({
    queryKey: ['fms', 'record-stock', recordId],
    queryFn: () => api<Move[]>(`/api/fms/records/${recordId}/stock`),
    staleTime: 10_000,
  });
  const moves = (q.data ?? []).filter((m) => m.stepId === stepId);
  if (!moves.length) return null;
  const state = (m: Move) =>
    m.status === 'PENDING'
      ? t(m.reversal ? 'stockSteps.record.reversalWaiting' : 'stockSteps.record.waiting')
      : m.status === 'REJECTED'
        ? t('stockSteps.record.notIssued')
        : m.reversed === 'APPLIED'
          ? t('stockSteps.record.reversed')
          : m.reversed === 'PENDING'
            ? t('stockSteps.record.reversalWaiting')
            : null;
  return (
    <ul className="mt-1.5 space-y-0.5 border-l-2 pl-2 text-xs">
      {moves.map((m) => {
        const tag = state(m);
        const gone = m.status === 'REJECTED' || m.reversed === 'APPLIED';
        return (
          <li key={m.id} className={cn('tabular-nums', gone && 'text-muted-foreground')}>
            <span className="font-medium">
              {m.reversal ? `${t('stockSteps.record.reversal')} · ` : ''}
              {t(`stockSteps.record.${m.type === 'ADJUST' ? 'OUT' : m.type}`)}
            </span>
            : <span className={cn(gone && 'line-through')}>{m.item.name}</span>{' '}
            {m.qty.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {m.item.unit}
            {m.type === 'TRANSFER' && m.toLocation ? ` → ${m.toLocation}` : ''}
            {tag && (
              <span
                className={cn(
                  'ml-1.5 rounded-pill px-1.5 py-0.5',
                  m.status === 'PENDING' || m.reversed === 'PENDING'
                    ? 'bg-status-warn-bg text-status-warn-fg'
                    : 'bg-status-neutral-bg text-status-neutral-fg',
                )}
              >
                {tag}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
