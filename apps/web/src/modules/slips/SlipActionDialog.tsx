import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson, SlipAction, SlipActionInput } from '@mono/shared';
import { personLabel } from '@/lib/people';
import { DateTimeInput } from '@/components/ui/date-input';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useActionMutation } from '@/lib/work';
import { isoToLocalInput, localInputToIso } from '@/lib/when';
import type { SlipDetail } from './api';

/** Every slip action with what it needs: a comment, a reason, or (approve) a solution + who does it by when. */
export function SlipActionDialog({
  slip,
  action,
  people,
  tz,
  onClose,
}: {
  slip: SlipDetail;
  action: SlipAction;
  people: OrgPerson[];
  tz: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const act = useActionMutation<SlipActionInput>('slips', 'slips');
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<string>(slip.solutions[0]?.id ?? 'own');
  const [doer, setDoer] = useState(slip.raiserId);
  // The decided solution should be under way within the company's "delegated within" time.
  const [when, setWhen] = useState(() =>
    isoToLocalInput(new Date(Date.now() + slip.delegateWithinHours * 3600_000), tz),
  );
  const [problem, setProblem] = useState(slip.problem);
  const [solutions, setSolutions] = useState(slip.solutions.map((s) => s.text));

  const input = (): SlipActionInput | null => {
    const long = text.trim().length >= 3;
    switch (action) {
      case 'forward':
        return { action, note: text.trim() || undefined };
      case 'return':
        return long ? { action, comment: text } : null;
      case 'reject':
        return long ? { action, reason: text } : null;
      case 'close':
        return { action, note: text.trim() || undefined };
      case 'withdraw':
        return { action, reason: text.trim() || undefined };
      case 'resubmit': {
        const filled = solutions.map((s) => s.trim()).filter(Boolean);
        return problem.trim().length >= 10 && filled.length >= slip.solutionsRequired
          ? { action, problem, solutions: filled }
          : null;
      }
      case 'approve':
        if (!doer) return null;
        if (choice === 'own')
          return long
            ? { action, ownSolution: text, doerId: doer, plannedAt: localInputToIso(when, tz) }
            : null;
        return { action, solutionId: choice, doerId: doer, plannedAt: localInputToIso(when, tz) };
    }
  };
  const body = input();

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`slip.dlg.${action}`)}
      description={`#${slip.number} · ${slip.problem.slice(0, 90)}`}
      footer={
        <Button
          variant={action === 'reject' || action === 'withdraw' ? 'destructive' : 'primary'}
          disabled={!body || act.isPending}
          onClick={() => body && act.mutate({ id: slip.id, input: body }, { onSuccess: onClose })}
        >
          {act.isPending && <Loader2 className="animate-spin" />} {t(`slip.act.${action}`)}
        </Button>
      }
    >
      <div className="space-y-4">
        {action === 'approve' && (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t('slip.pickSolution')}</legend>
              {[
                ...slip.solutions.map((s) => ({ id: s.id, text: s.text })),
                { id: 'own', text: t('slip.ownSolution') },
              ].map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-start gap-3 rounded-control border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="solution"
                    className="mt-0.5 accent-[var(--primary)]"
                    checked={choice === s.id}
                    onChange={() => setChoice(s.id)}
                  />
                  <span>{s.text}</span>
                </label>
              ))}
            </fieldset>
            {choice === 'own' && (
              <Field label={t('slip.ownSolution')}>
                <Textarea
                  className="font-sans"
                  rows={3}
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('task.doer')}>
                <Select value={doer} onChange={(e) => setDoer(e.target.value)}>
                  {people
                    .filter((p) => p.status === 'ACTIVE')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {personLabel(p)}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={t('task.col.planned')}>
                <DateTimeInput value={when} onChange={(v) => setWhen(v)} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{t('slip.approveHint')}</p>
          </>
        )}
        {action === 'resubmit' && (
          <>
            <Field label={t('slip.problem')}>
              <Textarea
                className="font-sans"
                rows={4}
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
              />
            </Field>
            {solutions.map((s, i) => (
              <Field key={i} label={t('slip.solutionN', { n: i + 1 })}>
                <Input
                  value={s}
                  onChange={(e) => setSolutions(solutions.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </Field>
            ))}
          </>
        )}
        {action !== 'approve' && action !== 'resubmit' && (
          <Field label={t(`slip.label.${action}`)}>
            <Textarea
              className="font-sans"
              rows={3}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
