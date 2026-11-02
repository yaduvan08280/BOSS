import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Send, Unlink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api';

type MyCode = { code: string; bot: string; deepLink: string; expiresAt: string };

/** "Link my Telegram": one tap opens the bot with the code already filled in. */
export function LinkMyTelegram() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['telegram-me'],
    queryFn: () => api<{ linked: boolean; bot: string | null }>('/api/notify/telegram/me'),
    refetchInterval: (q) => (q.state.data?.linked ? false : 5000),
  });
  const [code, setCode] = useState<MyCode | null>(null);
  const get = useMutation({
    mutationFn: () => api<MyCode>('/api/notify/telegram/my-code', { method: 'POST' }),
    onSuccess: setCode,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });
  const unlink = useMutation({
    mutationFn: () => api('/api/notify/telegram/unlink', { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['telegram-me'] }),
  });
  const linked = status.data?.linked;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-4" /> {t('notify.my.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {linked ? (
          <>
            <p className="flex items-center gap-2 text-sm text-status-ok-fg">
              <CheckCircle2 className="size-4" />{' '}
              {t('notify.my.linked', { bot: status.data?.bot ? `@${status.data.bot}` : 'Telegram' })}
            </p>
            <Button variant="ghost" size="sm" onClick={() => unlink.mutate()}>
              <Unlink /> {t('notify.my.unlink')}
            </Button>
          </>
        ) : code ? (
          <>
            <p className="text-sm text-muted-foreground">{t('notify.my.send', { bot: `@${code.bot}` })}</p>
            <div className="select-all rounded-control bg-muted py-3 text-center font-mono text-2xl font-semibold tracking-[0.3em]">
              {code.code}
            </div>
            <Button asChild variant="primary" className="w-full">
              <a href={code.deepLink} target="_blank" rel="noreferrer">
                <ExternalLink /> {t('notify.my.open', { bot: `@${code.bot}` })}
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">{t('notify.my.expires')}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('notify.my.why')}</p>
            <Button variant="primary" onClick={() => get.mutate()} disabled={get.isPending}>
              {t('notify.my.get')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
