import { Camera, Check, Loader2, Mic, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { formatShortDateTime } from '@/lib/when';
import { useChecklistMutation, useRun, type RunDetail } from './api';

type Item = RunDetail['items'][number];

/** Record a short voice note with the phone's microphone. */
function useVoice(onDone: (blob: Blob) => void) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const r = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      onDone(new Blob(chunks, { type: r.mimeType || 'audio/webm' }));
      setRec(null);
    };
    r.start();
    setRec(r);
  };
  return {
    recording: Boolean(rec),
    start: () => void start().catch(() => toast.error('Microphone not available')),
    stop: () => rec?.stop(),
  };
}

function ItemRow({
  item,
  run,
  editable,
  files,
}: {
  item: Item;
  run: RunDetail;
  editable: boolean;
  files: Map<string, { mime: string; url: string }>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(item.value ?? '');
  const [busy, setBusy] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  const tick = useChecklistMutation(
    (body: { done: boolean; value?: string | null; attachmentId?: string | null }) =>
      api(`/api/checklists/runs/${run.id}/items`, { method: 'POST', body: { itemId: item.id, ...body } }),
  );
  const attach = async (blob: Blob, name: string) => {
    setBusy(true);
    try {
      const up = await uploadFile(blob, name);
      tick.mutate({ done: true, value: value || null, attachmentId: up.id });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const voice = useVoice((b) => void attach(b, `voice-${Date.now()}.webm`));
  const file = item.attachmentId ? files.get(item.attachmentId) : undefined;

  return (
    <li className={cn('rounded-card border p-3', item.done && 'bg-status-ok-bg/40')}>
      <div className="flex items-start gap-3">
        <button
          disabled={!editable || tick.isPending}
          onClick={() => tick.mutate({ done: !item.done, value: value || null })}
          aria-pressed={item.done}
          aria-label={item.text}
          className={cn(
            'mt-0.5 grid size-7 shrink-0 place-items-center rounded-control border-2',
            item.done ? 'border-status-ok bg-status-ok text-white' : 'border-border bg-card',
          )}
        >
          {item.done && <Check className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{item.text}</div>
          <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
            {item.requirePhoto && <span>📷 {t('chk.needPhoto')}</span>}
            {item.requireVoice && <span>🎙 {t('chk.needVoice')}</span>}
            {item.requireValue && <span>✏️ {t('chk.needValue')}</span>}
          </div>
          {item.requireValue && (
            <Input
              className="mt-2 h-9 sm:h-9"
              value={value}
              disabled={!editable}
              onChange={(e) => setValue(e.target.value)}
              // Writing the value is doing the item, so a tap on the tick right after can't race it back to "not done".
              onBlur={() =>
                editable &&
                value !== (item.value ?? '') &&
                tick.mutate({ done: item.done || Boolean(value.trim()), value })
              }
              placeholder={t('chk.valuePh')}
            />
          )}
          {file &&
            (file.mime.startsWith('image/') ? (
              <img src={file.url} alt="" className="mt-2 h-24 rounded-control border object-cover" />
            ) : (
              <audio src={file.url} controls className="mt-2 h-9 w-full" />
            ))}
          {editable && (item.requirePhoto || item.requireVoice) && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => photo.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Camera />} {t('chk.photo')}
              </Button>
              {voice.recording ? (
                <Button size="sm" variant="destructive" onClick={voice.stop}>
                  <Square /> {t('chk.stop')}
                </Button>
              ) : (
                <Button size="sm" onClick={voice.start} disabled={busy}>
                  <Mic /> {t('chk.voice')}
                </Button>
              )}
              <input
                ref={photo}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && void attach(e.target.files[0], e.target.files[0].name)
                }
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function RunSheet({
  id,
  onClose,
  names,
  tz,
}: {
  id: string;
  onClose: () => void;
  names: Map<string, string>;
  tz: string;
}) {
  const { t } = useTranslation();
  const q = useRun(id);
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState('');
  const act = useChecklistMutation(
    (body: unknown) => api(`/api/checklists/runs/${id}/actions`, { method: 'POST', body }),
    t('org.saved'),
  );
  const run = q.data;
  const isDoer = run?.roles.includes('doer');
  const isVerifier = run?.roles.includes('verifier') || run?.roles.includes('admin');
  const files = new Map((run?.files ?? []).map((f) => [f.id, f]));
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        title={run?.master.name ?? '…'}
        description={
          run ? `${names.get(run.doerId) ?? ''} · ${formatShortDateTime(run.plannedAt, tz)}` : undefined
        }
      >
        {!run ? (
          <div className="p-5">
            <PageSkeleton />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <div className="flex items-center justify-between">
                <StatusChip
                  tone={
                    run.status === 'DONE'
                      ? 'ok'
                      : run.status === 'MISSED'
                        ? 'bad'
                        : run.status === 'PENDING_VERIFY'
                          ? 'warn'
                          : 'info'
                  }
                >
                  {t(`chk.status.${run.status}`)}
                </StatusChip>
                <span className="tabular text-sm text-muted-foreground">
                  {run.itemsDone}/{run.itemsTotal}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-pill bg-muted">
                <div
                  className="h-full bg-status-ok"
                  style={{ width: `${(run.itemsDone / Math.max(1, run.itemsTotal)) * 100}%` }}
                />
              </div>
              <ul className="space-y-2">
                {run.items.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    run={run}
                    files={files}
                    editable={Boolean(isDoer) && run.status === 'OPEN'}
                  />
                ))}
              </ul>
              {run.note && <p className="rounded-control bg-muted p-3 text-sm">{run.note}</p>}
              {isDoer && run.status === 'OPEN' && (
                <Textarea
                  className="font-sans"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('chk.notePh')}
                />
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
              {isDoer && run.status === 'OPEN' && (
                <Button
                  variant="primary"
                  disabled={run.itemsDone < run.itemsTotal || act.isPending}
                  onClick={() => act.mutate({ action: 'submit', note: note || undefined })}
                >
                  {t('chk.submit')}
                </Button>
              )}
              {isVerifier && run.status === 'PENDING_VERIFY' && (
                <>
                  <Button onClick={() => setRejecting(true)}>{t('task.act.reject')}</Button>
                  <Button variant="primary" onClick={() => act.mutate({ action: 'verify' })}>
                    {t('task.act.verify')}
                  </Button>
                </>
              )}
            </div>
            <Dialog
              open={rejecting}
              onOpenChange={setRejecting}
              title={t('task.act.reject')}
              footer={
                <Button
                  variant="primary"
                  disabled={why.trim().length < 3}
                  onClick={() =>
                    act.mutate(
                      { action: 'reject', comment: why },
                      { onSuccess: () => (setRejecting(false), setWhy('')) },
                    )
                  }
                >
                  {t('task.act.reject')}
                </Button>
              }
            >
              <Textarea
                className="font-sans"
                rows={3}
                autoFocus
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder={t('chk.rejectWhy')}
              />
            </Dialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
