import { Bot, MessagesSquare, Workflow } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { canOpenSystemMaster, hasPermission, type Me } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ChatView } from '@/modules/ai/ChatView';
import { useAiStatus } from '@/modules/ai/api';

/** The floating AI assistant (CLAUDE.md §13): the AI chat over the company's data, or draft a process. */
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
  // The conversation carries on while the page stays open; "Open the full chat" continues it there.
  const [chatId, setChatId] = useState<string | null>(null);
  const mayAsk = hasPermission(me.user.permissions, 'ai.view');
  const mayBuild = hasPermission(me.user.permissions, 'fms.edit');
  const connected = Boolean(ai.data?.connected);

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
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatView
              chatId={chatId}
              onChat={setChatId}
              tz={me.company.timezone}
              owner={me.user.permissions.includes('*')}
              compact
            />
            <div className="flex flex-wrap gap-2 border-t px-4 py-3">
              <Button asChild variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                <Link to={chatId ? `/ai/chat?c=${chatId}` : '/ai/chat'}>
                  <MessagesSquare /> {t('chat.openFull')}
                </Link>
              </Button>
              {mayBuild && (
                <Button asChild variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                  <Link to="/fms/builder/ai">
                    <Workflow /> {t('shell.ai.build')}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
