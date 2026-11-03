import { ExternalLink, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { EA_KINDS, minutesToHHmm, type EaAction, type EaActionInput, type OrgPerson } from '@mono/shared';
import { DateInput, DateTimeInput, TimeInput } from '@/components/ui/date-input';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useActionMutation, useWorkMutation } from '@/lib/work';
import { api } from '@/lib/api';
import { defaultPlanned, localInputToIso } from '@/lib/when';
import { EA_TONE, type EaBoard, type EaItem } from './api';

const ASKS: EaAction[] = ['schedule', 'delegate', 'toWaiting'];

/** One capture: edit the words, then sort it (schedule and delegate ask for when / who). */
export function EaItemDialog({
  item,
  board,
  people,
  tz,
  today,
  initial,
  slot,
  onClose,
}: {
  item: EaItem;
  board: EaBoard;
  people: OrgPerson[];
  tz: string;
  today: string;
  initial?: EaAction;
  slot?: { date: string; start: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const act = useActionMutation<EaActionInput>('ea/items', 'ea');
  const edit = useWorkMutation(
    (body: { text: string; note: string | null }) =>
      api(`/api/ea/items/${item.id}`, { method: 'PATCH', body }),
    [['ea']],
  );
  const [mode, setMode] = useState<EaAction | null>(initial && ASKS.includes(initial) ? initial : null);
  const [text, setText] = useState(item.text);
  const [note, setNote] = useState(item.note ?? '');
  const [date, setDate] = useState(slot?.date ?? item.scheduledDate ?? today);
  const [start, setStart] = useState(
    slot?.start ?? (item.slotStart !== null ? minutesToHHmm(item.slotStart) : board.settings.dayStart),
  );
  const [minutes, setMinutes] = useState(item.slotMinutes ?? 30);
  const [kind, setKind] = useState<(typeof EA_KINDS)[number]>(item.kind ?? 'task');
  const [doer, setDoer] = useState('');
  const [planned, setPlanned] = useState(defaultPlanned(tz));
  const [waitingOn, setWaitingOn] = useState(item.waitingOn ?? '');

  const run = (input: EaActionInput) => act.mutate({ id: item.id, input }, { onSuccess: onClose });
  const changed = text.trim() !== item.text || note !== (item.note ?? '');
  const confirm = () => {
    if (changed && text.trim()) edit.mutate({ text: text.trim(), note: note || null });
    if (mode === 'schedule') run({ action: 'schedule', date, start, minutes, kind });
    else if (mode === 'delegate' && doer)
      run({
        action: 'delegate',
        doerId: doer,
        plannedAt: localInputToIso(planned, tz),
        description: text.trim(),
      });
    else if (mode === 'toWaiting') run({ action: 'toWaiting', waitingOn: waitingOn.trim() || undefined });
    else onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`#${item.number}`}
      description={<StatusChip tone={EA_TONE[item.stage]}>{t(`ea.stage.${item.stage}`)}</StatusChip>}
      footer={
        <>
          {!mode &&
            item.actions
              .filter((a) => !ASKS.includes(a))
              .map((a) => (
                <Button
                  key={a}
                  variant={a === 'done' ? 'primary' : 'secondary'}
                  size="sm"
                  disabled={act.isPending}
                  onClick={() => run({ action: a } as EaActionInput)}
                >
                  {t(`ea.act.${a}`)}
                </Button>
              ))}
          {!mode &&
            item.actions
              .filter((a) => ASKS.includes(a))
              .map((a) => (
                <Button key={a} size="sm" onClick={() => setMode(a)}>
                  {t(`ea.act.${a}`)}
                </Button>
              ))}
          {(mode || changed) && (
            <Button
              variant="primary"
              disabled={act.isPending || (mode === 'delegate' && !doer)}
              onClick={confirm}
            >
              {act.isPending && <Loader2 className="animate-spin" />}{' '}
              {mode ? t(`ea.act.${mode}`) : t('common.save')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('ea.text')}>
          <Input value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label={t('ea.note')}>
          <Textarea className="font-sans" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {item.task && (
          <Link
            to={`/delegation?task=${item.task.id}`}
            className="flex items-center justify-between rounded-control border p-3 text-sm hover:bg-muted"
          >
            {t('ea.taskLink', { n: item.task.number, status: t(`task.status.${item.task.status}`) })}
            <ExternalLink className="size-4" />
          </Link>
        )}
        {mode === 'schedule' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('ea.date')}>
              <DateInput value={date} min={today} onChange={(v) => setDate(v)} />
            </Field>
            <Field label={t('ea.start')}>
              <TimeInput value={start} onChange={(v) => setStart(v)} />
            </Field>
            <Field label={t('ea.length')}>
              <Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[15, 30, 45, 60, 90, 120, 180].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('ea.kind')}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                {EA_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`ea.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {mode === 'delegate' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('task.doer')}>
              <Select value={doer} onChange={(e) => setDoer(e.target.value)}>
                <option value="">{t('org.choose')}</option>
                {people
                  .filter((p) => p.status === 'ACTIVE' && p.id !== board.ownerId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('task.col.planned')}>
              <DateTimeInput value={planned} onChange={(v) => setPlanned(v)} />
            </Field>
          </div>
        )}
        {mode === 'toWaiting' && (
          <Field
            label={t('ea.waitingOn')}
            hint={t('ea.waitingCap', { n: board.counts.WAITING, cap: board.settings.waitingCap })}
          >
            <Input
              value={waitingOn}
              placeholder={t('ea.waitingOnPh')}
              onChange={(e) => setWaitingOn(e.target.value)}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
