import { Copy, Loader2, MessageSquareQuote, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { detailsQuality, wordCount, type DetailsQuality } from '@mono/shared';
import { DictateButton } from '@/components/dictate';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { aiApi, useAiMutation, useAiStatus, useBusinessDetails } from './api';

const LEVELS: DetailsQuality[] = ['empty', 'short', 'fair', 'good', 'veryGood'];
const TONE: Record<DetailsQuality, string> = {
  empty: 'bg-status-neutral',
  short: 'bg-status-bad',
  fair: 'bg-status-warn',
  good: 'bg-status-info',
  veryGood: 'bg-status-ok',
};

/** A five-step meter: how much the AI has to go on ("Very good · 521 words"). */
export function QualityMeter({ words }: { words: number }) {
  const { t } = useTranslation();
  const q = detailsQuality(words);
  const at = LEVELS.indexOf(q);
  return (
    <div className="flex items-center gap-3" aria-label={t(`ai.quality.${q}`)}>
      <div className="flex gap-1">
        {LEVELS.slice(1).map((l, i) => (
          <span key={l} className={cn('h-2 w-8 rounded-pill', i < at ? TONE[q] : 'bg-muted')} />
        ))}
      </div>
      <span className="text-sm font-medium">
        {t(`ai.quality.${q}`)} · {t('ai.words', { count: words })}
      </span>
    </div>
  );
}

/** System Master → Business details (CLAUDE.md §13): the company in its own words, sent with every AI prompt. */
export function BusinessDetailsPage() {
  const q = useBusinessDetails();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return <DetailsForm key={q.data.updatedAt ?? 'new'} saved={q.data.text} />;
}

function DetailsForm({ saved }: { saved: string }) {
  const { t } = useTranslation();
  const status = useAiStatus();
  const [text, setText] = useState(saved);
  const [proposal, setProposal] = useState<string | null>(null);
  const [chatGpt, setChatGpt] = useState(false);
  const save = useAiMutation(
    () => aiApi.saveDetails(text),
    () => t('org.saved'),
  );
  const refresh = useAiMutation(() => aiApi.refreshDetails());
  const connected = status.data?.connected ?? false;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader>
          <CardTitle>{t('ai.biz.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <QualityMeter words={wordCount(text)} />
          <Textarea
            className="min-h-[320px] font-sans"
            value={text}
            aria-label={t('ai.biz.title')}
            placeholder={t('ai.biz.placeholder')}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={save.isPending || text === saved}
              onClick={() => save.mutate(undefined)}
            >
              {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
            </Button>
            <DictateButton onText={(s) => setText((x) => (x.trim() ? `${x.trimEnd()} ${s}` : s))} />
            <Button
              variant="secondary"
              disabled={!connected || refresh.isPending}
              title={connected ? undefined : t('ai.connectFirst')}
              onClick={() => refresh.mutate(undefined, { onSuccess: (r) => setProposal(r.text) })}
            >
              {refresh.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {t('ai.biz.refresh')}
            </Button>
            <Button variant="secondary" onClick={() => setChatGpt(true)}>
              <MessageSquareQuote /> {t('ai.biz.chatGpt')}
            </Button>
          </div>
          {!connected && status.isSuccess && (
            <p className="text-xs text-muted-foreground">{t('ai.connectFirst')}</p>
          )}
        </CardContent>
      </Card>
      <Card className="self-start">
        <CardHeader>
          <CardTitle>{t('ai.biz.whatTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {(t('ai.biz.what', { returnObjects: true }) as string[]).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t('ai.biz.privacy')}</p>
        </CardContent>
      </Card>
      {proposal !== null && (
        <Proposal
          title={t('ai.biz.refreshTitle')}
          text={proposal}
          onUse={(v) => (setText(v), setProposal(null))}
          onClose={() => setProposal(null)}
        />
      )}
      {chatGpt && (
        <ChatGptDialog onUse={(v) => (setText(v), setChatGpt(false))} onClose={() => setChatGpt(false)} />
      )}
    </div>
  );
}

/** The AI's version, editable, for the person to take or leave (nothing is saved until Save). */
function Proposal({
  title,
  text,
  onUse,
  onClose,
}: {
  title: string;
  text: string;
  onUse: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState(text);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={t('ai.biz.reviewHint')}
      footer={
        <Button variant="primary" disabled={!v.trim()} onClick={() => onUse(v)}>
          {t('ai.biz.use')}
        </Button>
      }
    >
      <div className="space-y-2">
        <QualityMeter words={wordCount(v)} />
        <Textarea className="min-h-[300px] font-sans" value={v} onChange={(e) => setV(e.target.value)} />
      </div>
    </Dialog>
  );
}

function ChatGptDialog({ onUse, onClose }: { onUse: (text: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const load = useAiMutation(() => aiApi.chatGptPrompt());
  const copy = async (p: string) => {
    try {
      await navigator.clipboard.writeText(p);
      toast.success(t('ai.biz.copied'));
    } catch {
      toast.error(t('ai.biz.copyFailed'));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('ai.biz.chatGptTitle')}
      description={t('ai.biz.chatGptHint')}
      footer={
        <Button variant="primary" disabled={wordCount(answer) < 20} onClick={() => onUse(answer.trim())}>
          {t('ai.biz.use')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('ai.biz.step1')}>
          {prompt === null ? (
            <Button
              variant="secondary"
              disabled={load.isPending}
              onClick={() =>
                load.mutate(undefined, { onSuccess: (r) => (setPrompt(r.prompt), void copy(r.prompt)) })
              }
            >
              {load.isPending ? <Loader2 className="animate-spin" /> : <Copy />} {t('ai.biz.copyPrompt')}
            </Button>
          ) : (
            <div className="space-y-2">
              <Textarea
                readOnly
                rows={5}
                className="font-sans text-xs"
                value={prompt}
                aria-label={t('ai.biz.step1')}
              />
              <Button size="sm" variant="secondary" onClick={() => void copy(prompt)}>
                <Copy /> {t('ai.biz.copyAgain')}
              </Button>
            </div>
          )}
        </Field>
        <Field label={t('ai.biz.step2')}>
          <Textarea
            rows={8}
            className="font-sans"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
