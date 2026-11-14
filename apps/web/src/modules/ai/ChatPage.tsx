import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { canOpenSystemMaster, formatDateTime, type Me } from '@mono/shared';
import { EmptyState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { Bot } from 'lucide-react';
import { useAiStatus } from './api';
import { deleteChat, useChats } from './chatApi';
import { ChatView } from './ChatView';

/** AI chat: the owner asks anything about the company; others ask about their own work and branches. */
export function ChatPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = useAiStatus();
  const chats = useChats();
  const [params, setParams] = useSearchParams();
  const chatId = params.get('c');
  const owner = me.user.permissions.includes('*');
  const tz = me.company.timezone;
  const open = (id: string | null) => setParams(id ? { c: id } : {}, { replace: false });
  const remove = async (id: string) => {
    await deleteChat(id);
    await qc.invalidateQueries({ queryKey: ['ai', 'chats'] });
    if (id === chatId) open(null);
  };

  if (status.data && !status.data.connected)
    return (
      <div className="space-y-5">
        <PageHeader title={t('nav.aiChat')} subtitle={t('navDesc.aiChat')} />
        <EmptyState
          icon={Bot}
          title={t('shell.ai.notConnected')}
          action={
            canOpenSystemMaster(me.user.permissions) ? (
              <Button asChild variant="primary">
                <Link to="/system/integration/ai">{t('shell.ai.connect')}</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col gap-3 lg:h-[calc(100dvh-7rem)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={t('nav.aiChat')}
          subtitle={owner ? t('chat.ownerSubtitle') : t('chat.staffSubtitle')}
        />
        <div className="flex items-center gap-2 lg:hidden">
          {(chats.data?.length ?? 0) > 0 && (
            <Select
              value={chatId ?? ''}
              onChange={(e) => open(e.target.value || null)}
              className="h-10 w-44"
              aria-label={t('chat.history')}
            >
              <option value="">{t('chat.newChat')}</option>
              {chats.data!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          )}
          <Button variant="secondary" size="icon" aria-label={t('chat.newChat')} onClick={() => open(null)}>
            <MessageSquarePlus />
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col gap-2 overflow-y-auto rounded-card border bg-card p-2 lg:flex">
          <Button variant="primary" onClick={() => open(null)}>
            <MessageSquarePlus /> {t('chat.newChat')}
          </Button>
          {(chats.data ?? []).map((c) => (
            <div
              key={c.id}
              className={cn(
                'group flex items-center gap-1 rounded-control px-2 py-1.5 text-sm hover:bg-muted',
                c.id === chatId && 'bg-muted',
              )}
            >
              <button onClick={() => open(c.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate font-medium">{c.title}</div>
                <div className="text-xs text-muted-foreground">{formatDateTime(c.updatedAt, tz)}</div>
              </button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('chat.delete')}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => void remove(c.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </aside>
        <section className="flex min-h-0 min-w-0 flex-col rounded-card border bg-card px-3 sm:px-5">
          <ChatView key={chatId ?? 'new'} chatId={chatId} onChat={open} tz={tz} owner={owner} />
        </section>
      </div>
    </div>
  );
}
