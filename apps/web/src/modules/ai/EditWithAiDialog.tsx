import { Loader2, Minus, PencilLine, Plus, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diffIsEmpty, type FlowDefinition } from '@mono/shared';
import { DictateButton } from '@/components/dictate';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { aiApi, useAiMutation, type EditResult } from './api';

const QUICK = ['approval', 'photo', 'whatsapp', 'shorter'] as const;

/** "Edit with AI" on a flow: say the change, see what would change, accept or reject (CLAUDE.md §6.2). */
export function EditWithAiDialog({
  flowId,
  onAccept,
  onClose,
}: {
  flowId: string;
  onAccept: (def: FlowDefinition) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [result, setResult] = useState<EditResult | null>(null);
  const run = useAiMutation(() => aiApi.editFlow(flowId, text));
  const d = result?.diff;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('ai.edit.title')}
      description={t('ai.edit.hint')}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => setResult(null)}>
              {t('ai.edit.reject')}
            </Button>
            <Button
              variant="primary"
              disabled={!d || diffIsEmpty(d)}
              onClick={() => onAccept(result.definition)}
            >
              {t('ai.edit.accept')}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={text.trim().length < 5 || run.isPending}
            onClick={() => run.mutate(undefined, { onSuccess: setResult })}
          >
            {run.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('ai.edit.run')}
          </Button>
        )
      }
    >
      {!result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <Button
                key={q}
                size="sm"
                variant="secondary"
                onClick={() => setText(t(`ai.edit.quick.${q}Text`))}
              >
                {t(`ai.edit.quick.${q}`)}
              </Button>
            ))}
          </div>
          <Textarea
            rows={4}
            className="font-sans"
            value={text}
            autoFocus
            aria-label={t('ai.edit.title')}
            placeholder={t('ai.edit.placeholder')}
            onChange={(e) => setText(e.target.value)}
          />
          <DictateButton onText={(v) => setText((x) => `${x} ${v}`.trim())} />
        </div>
      ) : diffIsEmpty(result.diff) ? (
        <p className="text-sm">{t('ai.edit.nothing')}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {result.diff.added.map((s) => (
            <li key={`a-${s.key}`} className="flex items-center gap-2 text-status-ok-fg">
              <Plus className="size-4 shrink-0" /> {t('ai.edit.added', { name: s.name })}
            </li>
          ))}
          {result.diff.removed.map((s) => (
            <li key={`r-${s.key}`} className="flex items-center gap-2 text-status-bad-fg">
              <Minus className="size-4 shrink-0" /> {t('ai.edit.removed', { name: s.name })}
            </li>
          ))}
          {result.diff.changed.map((s) => (
            <li key={`c-${s.key}`} className="flex items-start gap-2">
              <PencilLine className="mt-0.5 size-4 shrink-0" />
              <span>
                {s.name}: {s.what.map((w) => t(`ai.edit.what.${w}`)).join(', ')}
              </span>
            </li>
          ))}
          {result.diff.startFieldsAdded.map((l) => (
            <li key={`fa-${l}`} className="flex items-center gap-2 text-status-ok-fg">
              <Plus className="size-4 shrink-0" /> {t('ai.edit.fieldAdded', { name: l })}
            </li>
          ))}
          {result.diff.startFieldsRemoved.map((l) => (
            <li key={`fr-${l}`} className="flex items-center gap-2 text-status-bad-fg">
              <Minus className="size-4 shrink-0" /> {t('ai.edit.fieldRemoved', { name: l })}
            </li>
          ))}
          {result.unmatched.length > 0 && (
            <li className="pt-2 text-xs text-status-warn-fg">
              {t('ai.build.unmatched')}: {result.unmatched.map((u) => u.name).join(', ')}
            </li>
          )}
        </ul>
      )}
    </Dialog>
  );
}
