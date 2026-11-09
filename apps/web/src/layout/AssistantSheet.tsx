import { Bot, Send, Sparkles, Workflow } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { canOpenSystemMaster, hasPermission, type Me } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AskPanel } from '@/modules/ai/AskPanel';
import { useAiStatus } from '@/modules/ai/api';

const EXAMPLES = ['overdue', 'leave', 'stock'] as const;

/** The floating AI assistant (CLAUDE.md §13): Ask questions about the company's data, or draft a process. */
export function AssistantSheet({
  me,
  open,
  onOpenChange,
}: {
  me: Me;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const ai = useAiStatus();
  const [text, setText] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const mayAsk = hasPermission(me.user.permissions, 'ai.view');
  const mayBuild = hasPermission(me.user.permissions, 'fms.edit');
  const connected = Boolean(ai.data?.connected);
  const ask = (q: string) => {
    const question = q.trim();
    if (question.length < 3) return;
    setAsked(question);
    setText('');
  };

  const notice = (body: string, action?: { to: string; label: string }) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="grid size-16 place-items-center rounded-card bg-accent-soft text-accent-soft-foreground">
        <Bot className="size-7" />
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">{body}</p>
      {action && (
        <Button asChild variant="primary" onClick={() => onOpenChange(false)}>
          <Link to={action.to}>{action.label}</Link>
        </Button>
      )}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title={t('shell.assistant')} description={t('shell.ai.subtitle')}>
        {!mayAsk ? (
          notice(t('shell.ai.noAccess'))
        ) : ai.isPending ? null : !connected ? (
          notice(
            t('shell.ai.notConnected'),
            canOpenSystemMaster(me.user.permissions)
              ? { to: '/system/integration/ai', label: t('shell.ai.connect') }
              : undefined,
          )
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(text);
              }}
              className="flex items-center gap-2"
            >
              <input
                autoFocus
                value={text}
                maxLength={500}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('shell.ai.placeholder')}
                aria-label={t('shell.ai.placeholder')}
                className="h-11 min-w-0 flex-1 rounded-control border bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="submit"
                variant="primary"
                size="icon"
                disabled={text.trim().length < 3}
                aria-label={t('shell.ai.ask')}
              >
                <Send />
              </Button>
            </form>
            {asked ? (
              <AskPanel
                key={asked}
                question={asked}
                tz={me.company.timezone}
                onClose={() => setAsked(null)}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{t('shell.ai.try')}</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((k) => (
                    <button
                      key={k}
                      onClick={() => ask(t(`shell.ai.example.${k}`))}
                      className="flex items-center gap-1.5 rounded-pill border bg-card px-3 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <Sparkles className="size-3.5 shrink-0 text-primary" />
                      {t(`shell.ai.example.${k}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mayBuild && (
              <Button asChild className="mt-auto" onClick={() => onOpenChange(false)}>
                <Link to="/fms/builder/ai">
                  <Workflow /> {t('shell.ai.build')}
                </Link>
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
