import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { RecordDefinition } from '@mono/shared';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';
import { useAiStatus } from '@/modules/ai/api';
import { Button } from './ui';

/** What the AI hands back: a record type for the editor (not saved), and what MONO still finds wrong with it. */
export type AiTypeDraft = {
  name: string;
  pluralName: string;
  prefix: string;
  description: string;
  definition: RecordDefinition;
  problems: string[];
};

const EXAMPLES = ['siteVisit', 'trip', 'prescription'] as const;

/**
 * "Build with AI" (plan §2.6): describe the record type in your own words; the editor opens on the AI's draft.
 * Nothing is saved until the person checks it and presses Save.
 */
export function AiDraftDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ai = useAiStatus();
  const [text, setText] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const draft = useWorkMutation(
    () => api<AiTypeDraft>('/api/ai/record-types/draft', { method: 'POST', body: { text: text.trim() } }),
    [],
  );
  const connected = ai.data?.connected;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('recordsReach.ai.title')}
      description={t('recordsReach.ai.body')}
      footer={
        connected ? (
          <Button
            variant="primary"
            disabled={text.trim().length < 10 || draft.isPending}
            onClick={() =>
              draft.mutate(undefined, {
                onSuccess: (d) => navigate('/records/types/new', { state: { aiDraft: d } }),
                onError: (e) => setRefused(e instanceof ApiError ? e.message : null),
              })
            }
          >
            {draft.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {draft.isPending ? t('recordsReach.ai.working') : t('recordsReach.ai.go')}
          </Button>
        ) : undefined
      }
    >
      {ai.isSuccess && !connected ? (
        <p className="text-sm">
          {t('recordsReach.ai.notConnected')}{' '}
          <Link to="/system/integration/ai" className="font-medium underline underline-offset-2">
            {t('recordsReach.ai.connect')}
          </Link>
        </p>
      ) : (
        <div className="space-y-3">
          <Textarea
            className="min-h-32 font-sans"
            rows={5}
            maxLength={4000}
            aria-label={t('recordsReach.ai.title')}
            placeholder={t('recordsReach.ai.placeholder')}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setRefused(null);
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setText(t(`recordsReach.ai.ex.${k}.text`))}
                className="min-h-11 rounded-pill border bg-card px-3 text-sm md:min-h-9"
              >
                {t(`recordsReach.ai.ex.${k}.label`)}
              </button>
            ))}
          </div>
          {refused && (
            <p role="alert" className="text-sm text-status-bad-fg">
              {refused}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
