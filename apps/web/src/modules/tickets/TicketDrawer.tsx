import { FileText, Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson, TicketAction, TicketActionInput } from '@mono/shared';
import { FileDrop } from '@/components/file-drop';
import { PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { InfoRow, Timeline } from '@/components/work';
import { useActionMutation, useDueLabel } from '@/lib/work';
import type { Uploaded } from '@/lib/upload';
import { formatDateTime, formatShortDateTime, isoToLocalInput, localInputToIso } from '@/lib/when';
import { TICKET_TONE, useTicket, type TicketDetail } from './api';

const DIALOG: TicketAction[] = ['resolve', 'reopen', 'movePlan', 'reassign', 'cancel'];

/** One ticket: the issue, the conversation, SLA and escalation, and what this person may do now. */
export function TicketDrawer({
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
  const q = useTicket(id);
  const act = useActionMutation<TicketActionInput>('tickets', 'tickets');
  const due = useDueLabel();
  const [dialog, setDialog] = useState<TicketAction | null>(null);
  const [text, setText] = useState('');
  const names = new Map(people.map((p) => [p.id, p.name]));
  const tk = q.data;
  const say = tk?.actions.includes('reply') ? 'reply' : tk?.actions.includes('comment') ? 'comment' : null;
  const send = () =>
    say &&
    act.mutate({ id, input: { action: say, text, attachmentIds: [] } }, { onSuccess: () => setText('') });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        title={tk ? `T#${tk.number} · ${tk.title}` : '…'}
        description={
          tk
            ? t('ticket.byOn', { name: names.get(tk.raiserId), at: formatShortDateTime(tk.createdAt, tz) })
            : undefined
        }
      >
        {!tk ? (
          <div className="p-5">
            <PageSkeleton />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap gap-1">
                <StatusChip tone={TICKET_TONE[tk.status]}>{t(`ticket.status.${tk.status}`)}</StatusChip>
                {tk.escalationLevel > 0 && (
                  <StatusChip tone="bad">{t('ticket.escalatedL', { level: tk.escalationLevel })}</StatusChip>
                )}
                {tk.replyDueAt && (tk.status === 'OPEN' || tk.status === 'IN_PROGRESS') && (
                  <StatusChip tone={new Date(tk.replyDueAt) < new Date() ? 'bad' : 'neutral'}>
                    {t('ticket.replyDue', { when: due(tk.replyDueAt) })}
                  </StatusChip>
                )}
                {(tk.status === 'OPEN' || tk.status === 'IN_PROGRESS') && (
                  <StatusChip tone={new Date(tk.plannedFixAt) < new Date() ? 'bad' : 'info'}>
                    {t('ticket.fixDue', { when: due(tk.plannedFixAt) })}
                  </StatusChip>
                )}
                {tk.reopenCount > 0 && (
                  <StatusChip tone="warn">{t('ticket.reopenedN', { count: tk.reopenCount })}</StatusChip>
                )}
              </div>
              {tk.description && <p className="whitespace-pre-wrap text-sm">{tk.description}</p>}
              <div>
                <InfoRow label={t('ticket.solver')}>{names.get(tk.solverId)}</InfoRow>
                <InfoRow label={t('ticket.coordinator')}>
                  {tk.coordinatorId ? names.get(tk.coordinatorId) : '—'}
                </InfoRow>
                <InfoRow label={t('ticket.fixBy')}>{formatDateTime(tk.plannedFixAt, tz)}</InfoRow>
                {tk.closedAt && (
                  <InfoRow
                    label={t('ticket.closedAt')}
                  >{`${formatDateTime(tk.closedAt, tz)}${tk.closedBy === 'auto' ? ` · ${t('ticket.auto')}` : ''}`}</InfoRow>
                )}
              </div>
              {tk.files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tk.files.map((f) =>
                    f.mime.startsWith('image/') ? (
                      <a
                        key={f.id}
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        title={names.get(f.uploadedById)}
                      >
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
                <h3 className="mb-2 text-sm font-semibold">{t('ticket.thread')}</h3>
                <Timeline
                  events={tk.events}
                  names={names}
                  tz={tz}
                  describe={(e) =>
                    e.type === 'status'
                      ? t('ticket.ev.status', { to: t(`ticket.status.${e.toStatus}`) })
                      : e.type === 'plan_moved' && e.toDate
                        ? t('ticket.ev.plan_moved', { to: formatShortDateTime(e.toDate, tz) })
                        : t(`ticket.ev.${e.type}`)
                  }
                />
              </section>
              {say && (
                <div className="space-y-2">
                  <Textarea
                    className="font-sans"
                    rows={2}
                    value={text}
                    placeholder={t(`ticket.${say}Ph`)}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={send} disabled={!text.trim() || act.isPending}>
                      {act.isPending ? <Loader2 className="animate-spin" /> : <Send />}{' '}
                      {t(`ticket.act.${say}`)}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {tk.actions.some((a) => a === 'confirm' || DIALOG.includes(a)) && (
              <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
                {tk.actions
                  .filter((a) => a === 'confirm' || DIALOG.includes(a))
                  .map((a) => (
                    <Button
                      key={a}
                      variant={
                        a === 'resolve' || a === 'confirm'
                          ? 'primary'
                          : a === 'cancel'
                            ? 'ghost'
                            : 'secondary'
                      }
                      onClick={() =>
                        a === 'confirm' ? act.mutate({ id, input: { action: 'confirm' } }) : setDialog(a)
                      }
                    >
                      {t(`ticket.act.${a}`)}
                    </Button>
                  ))}
              </div>
            )}
          </>
        )}
        {tk && dialog && (
          <TicketDialog ticket={tk} action={dialog} people={people} tz={tz} onClose={() => setDialog(null)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TicketDialog({
  ticket,
  action,
  people,
  tz,
  onClose,
}: {
  ticket: TicketDetail;
  action: TicketAction;
  people: OrgPerson[];
  tz: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const act = useActionMutation<TicketActionInput>('tickets', 'tickets');
  const [text, setText] = useState('');
  const [when, setWhen] = useState(isoToLocalInput(ticket.plannedFixAt, tz));
  const [solver, setSolver] = useState('');
  const [files, setFiles] = useState<Uploaded[]>([]);
  const long = text.trim().length >= 3;
  const body: TicketActionInput | null =
    action === 'resolve'
      ? long && (!ticket.proofToResolve || files.length)
        ? { action, note: text, attachmentIds: files.map((f) => f.id) }
        : null
      : action === 'reopen'
        ? long
          ? { action, comment: text }
          : null
        : action === 'movePlan'
          ? long
            ? { action, plannedFixAt: localInputToIso(when, tz), reason: text }
            : null
          : action === 'reassign'
            ? solver
              ? { action, solverId: solver, plannedFixAt: localInputToIso(when, tz) }
              : null
            : { action: 'cancel', reason: text.trim() || undefined };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`ticket.dlg.${action}`)}
      description={`T#${ticket.number} · ${ticket.title}`}
      footer={
        <Button
          variant={action === 'cancel' ? 'destructive' : 'primary'}
          disabled={!body || act.isPending}
          onClick={() => body && act.mutate({ id: ticket.id, input: body }, { onSuccess: onClose })}
        >
          {act.isPending && <Loader2 className="animate-spin" />} {t(`ticket.act.${action}`)}
        </Button>
      }
    >
      <div className="space-y-4">
        {(action === 'movePlan' || action === 'reassign') && (
          <Field label={t('ticket.fixBy')}>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        )}
        {action === 'reassign' ? (
          <Field label={t('ticket.solver')}>
            <Select value={solver} onChange={(e) => setSolver(e.target.value)}>
              <option value="">{t('org.choose')}</option>
              {people
                .filter((p) => p.status === 'ACTIVE' && p.id !== ticket.solverId && p.id !== ticket.raiserId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        ) : (
          <Field label={t(`ticket.label.${action}`)}>
            <Textarea
              className="font-sans"
              rows={3}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        )}
        {action === 'resolve' && (
          <Field label={ticket.proofToResolve ? `${t('ticket.proof')} *` : t('ticket.proof')}>
            <FileDrop files={files} onChange={setFiles} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
