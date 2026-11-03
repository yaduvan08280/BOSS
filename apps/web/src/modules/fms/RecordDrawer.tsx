import { FileDown, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson } from '@mono/shared';
import { PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { InfoRow, TabStrip, Timeline } from '@/components/work';
import { api } from '@/lib/api';
import { personLabel } from '@/lib/people';
import { cn } from '@/lib/utils';
import { useDueLabel, useWorkMutation } from '@/lib/work';
import { formatDateTime } from '@/lib/when';
import { RECORD_TONE, useRecord, type RecordDetail, type StepRow } from './api';
import { showValue } from './show';
import { StepDialog } from './StepDialog';

const TABS = ['timeline', 'plan', 'documents', 'history'] as const;
type Tab = (typeof TABS)[number];

/** One record: every step with doer, planned and actual time, documents, history and the actions allowed. */
export function RecordDrawer({
  id,
  tz,
  people,
  onClose,
}: {
  id: string;
  tz: string;
  people: OrgPerson[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useRecord(id);
  const [tab, setTab] = useState<Tab>('timeline');
  const [doing, setDoing] = useState<StepRow | null>(null);
  const [act, setAct] = useState<'hold' | 'close' | 'cancel' | 'reassign' | null>(null);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const due = useDueLabel();
  const r = q.data;
  const resume = useWorkMutation(
    () => api(`/api/fms/records/${id}/actions`, { method: 'POST', body: { action: 'resume' } }),
    [['fms']],
  );
  const open = r?.steps.find((s) => s.status === 'OPEN');

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        title={r ? `${r.title} · #${r.number}` : '…'}
        description={r ? `${r.flow.name} · v${r.version}` : undefined}
      >
        {!r ? (
          <div className="p-5">
            <PageSkeleton />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap gap-1">
                <StatusChip tone={RECORD_TONE[r.status]}>{t(`fms.status.${r.status}`)}</StatusChip>
                {open && (
                  <StatusChip tone={new Date(open.plannedAt) < new Date() ? 'bad' : 'info'}>
                    {`${t('fms.onStep', { step: open.stepName, n: open.position + 1, of: r.definition.steps.length })} · ${due(open.plannedAt)}`}
                  </StatusChip>
                )}
              </div>
              {r.holdReason && r.status === 'ON_HOLD' && (
                <p className="rounded-control bg-status-warn-bg p-2.5 text-sm text-status-warn-fg">
                  {r.holdReason}
                </p>
              )}
              <div>
                {r.definition.startFields.map((f) => {
                  const shown = showValue(f, r.data[f.key], tz, [t('fms.yes'), t('fms.no')]);
                  return shown ? (
                    <InfoRow key={f.key} label={f.label}>
                      {shown}
                    </InfoRow>
                  ) : null;
                })}
                <InfoRow label={t('fms.startedBy')}>
                  {r.startedById ? names.get(r.startedById) : t(`fms.source.${r.source}`)}
                </InfoRow>
                <InfoRow label={t('fms.startedAt')}>{formatDateTime(r.startedAt, tz)}</InfoRow>
              </div>
              <TabStrip tabs={TABS} active={tab} onChange={setTab} label={(k) => t(`fms.tab.${k}`)} />
              {tab === 'timeline' && (
                <ol className="space-y-2">
                  {r.steps.map((s) => {
                    const late = s.doneAt
                      ? new Date(s.doneAt) > new Date(s.plannedAt)
                      : new Date(s.plannedAt) < new Date();
                    return (
                      <li
                        key={s.id}
                        className={cn(
                          'rounded-control border p-3 text-sm',
                          s.status === 'OPEN' && 'border-primary',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold">
                              {s.position + 1}. {s.stepName}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {s.doerId ? names.get(s.doerId) : t('fms.system')} · {t('fms.planned')}{' '}
                              {formatDateTime(s.plannedAt, tz)}
                              {s.doneAt && ` · ${t('fms.done')} ${formatDateTime(s.doneAt, tz)}`}
                            </div>
                          </div>
                          <StatusChip
                            tone={
                              s.status === 'OPEN'
                                ? late
                                  ? 'bad'
                                  : 'info'
                                : s.status === 'SKIPPED'
                                  ? 'neutral'
                                  : late
                                    ? 'warn'
                                    : 'ok'
                            }
                          >
                            {s.status === 'OPEN'
                              ? late
                                ? t('fms.delayed')
                                : t('fms.waiting')
                              : s.status === 'SKIPPED'
                                ? t('fms.skipped')
                                : late
                                  ? t('fms.doneLate')
                                  : t('fms.onTime')}
                          </StatusChip>
                        </div>
                        {s.decision && <div className="mt-1 text-xs">{t(`fms.decision.${s.decision}`)}</div>}
                        {s.note && <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>}
                        {Object.entries(s.data).length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {Object.entries(s.data)
                              .map(([k, v]) => {
                                const f = r.definition.steps
                                  .find((x) => x.key === s.stepKey)
                                  ?.fields.find((x) => x.key === k);
                                const shown = showValue(f, v, tz, [t('fms.yes'), t('fms.no')]);
                                return shown ? `${f?.label ?? k}: ${shown}` : null;
                              })
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                        {r.files.some((f) => f.entityId === s.id) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {r.files
                              .filter((f) => f.entityId === s.id)
                              .map((f) =>
                                f.mime.startsWith('image/') ? (
                                  <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
                                    <img
                                      src={f.url}
                                      alt={f.originalName}
                                      className="size-14 rounded-control border object-cover"
                                    />
                                  </a>
                                ) : (
                                  <a
                                    key={f.id}
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-control border px-2 py-1 text-xs"
                                  >
                                    {f.originalName}
                                  </a>
                                ),
                              )}
                          </div>
                        )}
                        {s.status === 'OPEN' && r.can.doSteps.includes(s.id) && r.status === 'RUNNING' && (
                          <Button size="sm" variant="primary" className="mt-2" onClick={() => setDoing(s)}>
                            {t('fms.doStep')}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {tab === 'plan' && <PlanVsActual r={r} />}
              {tab === 'documents' &&
                (r.documents.length ? (
                  <ul className="space-y-1.5">
                    {r.documents.map((d) => (
                      <li key={d.id}>
                        <a
                          href={`/api/documents/${d.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between rounded-control border p-2.5 text-sm hover:bg-muted"
                        >
                          <span className="flex items-center gap-2">
                            <FileText className="size-4" /> <span className="font-mono">{d.number}</span> ·{' '}
                            {d.type.name}
                          </span>
                          <span className="tabular text-xs">
                            {d.total !== null ? `₹${d.total.toLocaleString('en-IN')}` : ''}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('fms.noDocuments')}</p>
                ))}
              {tab === 'history' && (
                <Timeline
                  events={r.events}
                  names={names}
                  tz={tz}
                  describe={(e) =>
                    `${t(`fms.ev.${e.type}`)}${e.stepKey ? ` · ${r.definition.steps.find((s) => s.key === e.stepKey)?.name ?? e.stepKey}` : ''}`
                  }
                />
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
              <Button asChild size="sm" variant="ghost">
                <a href={`/api/fms/records/${r.id}/timeline.pdf`}>
                  <FileDown /> {t('fms.timelinePdf')}
                </a>
              </Button>
              {r.can.manage && open && r.status === 'RUNNING' && (
                <Button size="sm" onClick={() => setAct('reassign')}>
                  {t('fms.reassign')}
                </Button>
              )}
              {r.can.manage && r.status === 'RUNNING' && (
                <Button size="sm" onClick={() => setAct('hold')}>
                  {t('fms.hold')}
                </Button>
              )}
              {r.can.manage && r.status === 'ON_HOLD' && (
                <Button size="sm" disabled={resume.isPending} onClick={() => resume.mutate(undefined)}>
                  {t('fms.resume')}
                </Button>
              )}
              {r.can.manage && (r.status === 'RUNNING' || r.status === 'ON_HOLD') && (
                <Button size="sm" variant="ghost" onClick={() => setAct('close')}>
                  {t('fms.close')}
                </Button>
              )}
            </div>
          </>
        )}
        {r && doing && (
          <StepDialog
            stepId={doing.id}
            step={r.definition.steps.find((s) => s.key === doing.stepKey)!}
            title={`${r.title} · #${r.number}`}
            tz={tz}
            people={people}
            onClose={() => setDoing(null)}
          />
        )}
        {r && act && (
          <RecordActionDialog record={r} action={act} people={people} onClose={() => setAct(null)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PlanVsActual({ r }: { r: RecordDetail }) {
  const { t } = useTranslation();
  const hours = (a: string, b: string | null) =>
    b ? Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 3_600_000) * 10) / 10 : null;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-1.5">{t('fms.step')}</th>
          <th>{t('fms.plannedH')}</th>
          <th>{t('fms.actualH')}</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {r.steps
          .filter((s) => s.type !== 'AUTO')
          .map((s) => {
            const plan = hours(s.startedAt, s.plannedAt)!;
            const actual = hours(s.startedAt, s.doneAt);
            return (
              <tr key={s.id}>
                <td className="py-2">{s.stepName}</td>
                <td className="tabular">{plan}</td>
                <td
                  className={cn(
                    'tabular',
                    actual !== null && actual > plan && 'font-semibold text-status-bad-fg',
                  )}
                >
                  {actual ?? '—'}
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

/** Reassign the open step, hold or close the record — each with the reason it needs. */
function RecordActionDialog({
  record,
  action,
  people,
  onClose,
}: {
  record: RecordDetail;
  action: 'hold' | 'close' | 'cancel' | 'reassign';
  people: OrgPerson[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [doer, setDoer] = useState('');
  const open = record.steps.find((s) => s.status === 'OPEN');
  const run = useWorkMutation(
    () =>
      action === 'reassign'
        ? api(`/api/fms/steps/${open!.id}/reassign`, {
            method: 'POST',
            body: { doerId: doer, reason: reason || undefined },
          })
        : api(`/api/fms/records/${record.id}/actions`, {
            method: 'POST',
            body: { action, reason: reason || undefined },
          }),
    [['fms']],
    () => (action === 'reassign' ? t('fms.reassigned') : t('fms.saved')),
  );
  const ok = action === 'reassign' ? Boolean(doer) : action === 'close' || reason.trim().length >= 3;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`fms.dlg.${action}`)}
      description={`${record.title} · #${record.number}`}
      footer={
        <Button
          variant={action === 'close' ? 'secondary' : 'primary'}
          disabled={!ok || run.isPending}
          onClick={() => run.mutate(undefined, { onSuccess: onClose })}
        >
          {run.isPending && <Loader2 className="animate-spin" />} {t(`fms.${action}`)}
        </Button>
      }
    >
      <div className="space-y-4">
        {action === 'reassign' && open && (
          <Field label={t('fms.giveTo', { step: open.stepName })}>
            <Select value={doer} onChange={(e) => setDoer(e.target.value)}>
              <option value="">{t('org.choose')}</option>
              {people
                .filter((p) => p.status === 'ACTIVE' && p.id !== open.doerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label={action === 'hold' ? `${t('fms.why')} *` : t('fms.why')}>
          <Textarea
            className="font-sans"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
