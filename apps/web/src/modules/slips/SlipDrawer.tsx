import { CheckCircle2, ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { OrgPerson, SlipAction } from '@mono/shared';
import { PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { InfoRow, Timeline } from '@/components/work';
import { useDueLabel } from '@/lib/work';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/when';
import { SLIP_TONE, useSlip } from './api';
import { SlipActionDialog } from './SlipActionDialog';

const PRIMARY: SlipAction[] = ['forward', 'approve', 'resubmit', 'close'];

/** One slip: the problem, the raiser's solutions, the decision and its task, history and the actions allowed now. */
export function SlipDrawer({
  id,
  people,
  tz,
  onClose,
}: {
  id: string;
  people: OrgPerson[];
  tz: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useSlip(id);
  const due = useDueLabel();
  const [dialog, setDialog] = useState<SlipAction | null>(null);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const slip = q.data;
  const chosen = slip?.chosenSolutionId;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        title={slip ? t('slip.title', { n: slip.number }) : '…'}
        description={slip?.problem.slice(0, 120)}
      >
        {!slip ? (
          <div className="p-5">
            <PageSkeleton />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap gap-1">
                <StatusChip tone={SLIP_TONE[slip.status]}>{t(`slip.status.${slip.status}`)}</StatusChip>
                {slip.waitingOn && (
                  <StatusChip tone={new Date(slip.waitingOn.dueAt) < new Date() ? 'bad' : 'neutral'}>
                    {t('slip.waitingOn', {
                      name: names.get(slip.waitingOn.userId) ?? '?',
                      when: due(slip.waitingOn.dueAt),
                    })}
                  </StatusChip>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{slip.problem}</p>
              <section>
                <h3 className="mb-2 text-sm font-semibold">{t('slip.solutions')}</h3>
                <ol className="space-y-1.5">
                  {slip.solutions.map((s, i) => (
                    <li
                      key={s.id}
                      className={cn(
                        'flex gap-2 rounded-control border p-2.5 text-sm',
                        chosen === s.id && 'border-status-ok bg-status-ok-bg/40',
                      )}
                    >
                      <span className="font-semibold text-muted-foreground">{i + 1}.</span>
                      <span className="flex-1">{s.text}</span>
                      {chosen === s.id && (
                        <CheckCircle2 className="size-4 text-status-ok-fg" aria-label={t('slip.chosen')} />
                      )}
                    </li>
                  ))}
                  {slip.ownSolution && (
                    <li className="flex gap-2 rounded-control border border-status-ok bg-status-ok-bg/40 p-2.5 text-sm">
                      <span className="flex-1">
                        <span className="text-xs text-muted-foreground">{t('slip.decidersOwn')}: </span>
                        {slip.ownSolution}
                      </span>
                      <CheckCircle2 className="size-4 text-status-ok-fg" />
                    </li>
                  )}
                </ol>
              </section>
              {slip.task && (
                <Link
                  to={`/delegation?task=${slip.task.id}`}
                  className="flex items-center justify-between rounded-control border p-3 text-sm hover:bg-muted"
                >
                  <span>
                    {t('slip.linkedTask', { n: slip.task.number, name: names.get(slip.task.doerId) ?? '?' })}
                    <span className="ml-2 text-muted-foreground">{t(`task.status.${slip.task.status}`)}</span>
                  </span>
                  <ExternalLink className="size-4" />
                </Link>
              )}
              <div>
                <InfoRow label={t('slip.raiser')}>{names.get(slip.raiserId)}</InfoRow>
                <InfoRow label={t('slip.receiver')}>{names.get(slip.receiverId)}</InfoRow>
                <InfoRow label={t('slip.approver')}>{names.get(slip.approverId)}</InfoRow>
                <InfoRow label={t('slip.accountable')}>{names.get(slip.accountableId)}</InfoRow>
                <InfoRow label={t('slip.raisedAt')}>{formatDateTime(slip.createdAt, tz)}</InfoRow>
              </div>
              {slip.files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {slip.files.map((f) =>
                    f.mime.startsWith('image/') ? (
                      <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
                        <img
                          src={f.url}
                          alt={f.originalName}
                          className="size-20 rounded-control border object-cover"
                        />
                      </a>
                    ) : (
                      <a
                        key={f.id}
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-xs"
                      >
                        <FileText className="size-3.5" /> {f.originalName}
                      </a>
                    ),
                  )}
                </div>
              )}
              <section>
                <h3 className="mb-2 text-sm font-semibold">{t('slip.history')}</h3>
                <Timeline
                  events={slip.events}
                  names={names}
                  tz={tz}
                  describe={(e) =>
                    e.type === 'status'
                      ? t('slip.ev.status', { to: t(`slip.status.${e.toStatus}`) })
                      : t(`slip.ev.${e.type}`)
                  }
                />
              </section>
            </div>
            {slip.actions.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
                {slip.actions.map((a) => (
                  <Button
                    key={a}
                    variant={
                      PRIMARY.includes(a)
                        ? 'primary'
                        : a === 'reject' || a === 'withdraw'
                          ? 'ghost'
                          : 'secondary'
                    }
                    onClick={() => setDialog(a)}
                  >
                    {t(`slip.act.${a}`)}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
        {slip && dialog && (
          <SlipActionDialog
            slip={slip}
            action={dialog}
            people={people}
            tz={tz}
            onClose={() => setDialog(null)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
