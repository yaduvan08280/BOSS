import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';

type Check = {
  id: string;
  text: string;
  checklist: string;
  dueAt: string;
  photoUrl: string | null;
  doer: string;
};
type Mine = { answer: Check[]; judge: Check[] };
const send = (path: string, body: unknown) => api(path, { method: 'POST', body: JSON.stringify(body) });
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Surprise checks waiting on me: show a ticked item again with a photo taken now, or judge someone's photo. */
export function SpotCheckCard() {
  const q = useQuery({
    queryKey: ['spot-checks', 'mine'],
    queryFn: () => api<Mine>('/api/spot-checks/mine'),
    refetchInterval: 60_000,
  });
  if (!q.data || (!q.data.answer.length && !q.data.judge.length)) return null;
  return (
    <div className="mb-4 space-y-2">
      {q.data.answer.map((c) => (
        <Answer key={c.id} check={c} />
      ))}
      {q.data.judge.map((c) => (
        <Judge key={c.id} check={c} />
      ))}
    </div>
  );
}

function useDone() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['spot-checks'] });
    void qc.invalidateQueries({ queryKey: ['owner', 'spot'] });
  };
}

function Answer({ check }: { check: Check }) {
  const { t } = useTranslation();
  const file = useRef<HTMLInputElement>(null);
  const done = useDone();
  const m = useMutation({
    mutationFn: async (f: File) => {
      const up = await uploadFile(f, f.name || 'check.jpg');
      return send(`/api/spot-checks/${check.id}/answer`, { attachmentId: up.id });
    },
    onSuccess: () => {
      toast.success(t('spot.sent'));
      done();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('common.error')),
  });
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-status-warn-fg/40 bg-status-warn-bg p-3.5 text-status-warn-fg"
    >
      <div className="min-w-0 flex-1 basis-56 text-sm">
        <div className="font-semibold">{t('spot.showNow', { time: hhmm(check.dueAt) })}</div>
        <div className="break-words">
          {check.text} · <span className="opacity-80">{check.checklist}</span>
        </div>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) m.mutate(f);
          e.target.value = '';
        }}
      />
      <Button variant="primary" disabled={m.isPending} onClick={() => file.current?.click()}>
        {m.isPending ? <Loader2 className="animate-spin" /> : <Camera />} {t('spot.takePhoto')}
      </Button>
    </div>
  );
}

function Judge({ check }: { check: Check }) {
  const { t } = useTranslation();
  const [bad, setBad] = useState(false);
  const [note, setNote] = useState('');
  const done = useDone();
  const m = useMutation({
    mutationFn: (ok: boolean) => send(`/api/spot-checks/${check.id}/decide`, { ok, note: ok ? null : note }),
    onSuccess: () => {
      toast.success(t('org.saved'));
      done();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('common.error')),
  });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border bg-card p-3.5">
      {check.photoUrl && (
        <a href={check.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
          <img
            src={check.photoUrl}
            alt={check.text}
            className="size-16 rounded-control border object-cover"
          />
        </a>
      )}
      <div className="min-w-0 flex-1 basis-48 text-sm">
        <div className="font-semibold">{t('spot.judge', { name: check.doer })}</div>
        <div className="break-words text-muted-foreground">
          {check.text} · {check.checklist}
        </div>
      </div>
      {bad ? (
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Input
            autoFocus
            className="min-w-0 flex-1 basis-48"
            placeholder={t('spot.whatWrong')}
            aria-label={t('spot.whatWrong')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button variant="primary" disabled={!note.trim() || m.isPending} onClick={() => m.mutate(false)}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={() => setBad(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="primary" disabled={m.isPending} onClick={() => m.mutate(true)}>
            <Check /> {t('spot.ok')}
          </Button>
          <Button variant="secondary" disabled={m.isPending} onClick={() => setBad(true)}>
            <X /> {t('spot.notOk')}
          </Button>
        </div>
      )}
    </div>
  );
}
