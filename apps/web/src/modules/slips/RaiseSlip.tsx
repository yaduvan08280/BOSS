import { Loader2, Plus, Send, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { slipCreateSchema } from '@mono/shared';
import { DictateButton } from '@/components/dictate';
import { FileDrop } from '@/components/file-drop';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useWorkMutation } from '@/lib/work';
import { api } from '@/lib/api';
import type { Uploaded } from '@/lib/upload';
import type { SlipRow } from './api';

/** A problem plus the raiser's own solutions (the company decides how many are required). */
export function RaiseSlip({ required, onRaised }: { required: number; onRaised: (id: string) => void }) {
  const { t } = useTranslation();
  const [problem, setProblem] = useState('');
  const [solutions, setSolutions] = useState<string[]>(() =>
    Array.from({ length: Math.max(1, required) }, () => ''),
  );
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const raise = useWorkMutation(
    (body: unknown) => api<SlipRow>('/api/slips', { method: 'POST', body }),
    [['slips']],
    (s) => t('slip.raised', { n: s.number }),
  );

  const submit = () => {
    const filled = solutions.map((s) => s.trim()).filter(Boolean);
    if (filled.length < required) return setError(t('slip.needSolutions', { count: required }));
    const parsed = slipCreateSchema.safeParse({
      problem,
      solutions: filled,
      attachmentIds: files.map((f) => f.id),
    });
    if (!parsed.success) return setError(t('slip.problemShort'));
    setError(null);
    raise.mutate(parsed.data, {
      onSuccess: (s) => {
        setProblem('');
        setSolutions(solutions.map(() => ''));
        setFiles([]);
        onRaised(s.id);
      },
    });
  };

  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-4 pt-5">
        <Field label={`${t('slip.problem')} *`} hint={t('slip.problemHint')}>
          <Textarea
            className="font-sans"
            rows={4}
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
          />
        </Field>
        <DictateButton onText={(txt) => setProblem((p) => (p ? `${p} ${txt}` : txt))} />
        <div className="space-y-2">
          <div className="text-sm font-medium">
            {t('slip.yourSolutions')}{' '}
            <span className="text-muted-foreground">({t('slip.atLeast', { count: required })})</span>
          </div>
          {solutions.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                {i + 1}
              </span>
              <Input
                value={s}
                aria-label={t('slip.solutionN', { n: i + 1 })}
                placeholder={t('slip.solutionPh')}
                onChange={(e) => setSolutions(solutions.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {solutions.length > required && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.remove')}
                  onClick={() => setSolutions(solutions.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              )}
            </div>
          ))}
          {solutions.length < 3 && (
            <Button size="sm" variant="ghost" onClick={() => setSolutions([...solutions, ''])}>
              <Plus /> {t('slip.addSolution')}
            </Button>
          )}
        </div>
        <Field label={t('task.attach')}>
          <FileDrop files={files} onChange={setFiles} />
        </Field>
        {error && <p className="text-sm text-status-bad-fg">{error}</p>}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button variant="primary" size="lg" onClick={submit} disabled={raise.isPending}>
            {raise.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t('slip.submit')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('slip.submitHint')}</span>
        </div>
      </CardContent>
    </Card>
  );
}
