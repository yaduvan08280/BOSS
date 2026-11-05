import { Download, Share, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { canPrompt, isIos, isStandalone, promptInstall, subscribeInstall } from '@/lib/install';

const KEY = 'mono.install.dismissed';
const WAIT_DAYS = 30;
const dismissedRecently = () => {
  try {
    const at = Number(localStorage.getItem(KEY) ?? 0);
    return Date.now() - at < WAIT_DAYS * 86_400_000;
  } catch {
    return false;
  }
};

/** "Install {APP} on this phone": the browser's own offer, or the iPhone steps. Hidden once installed or closed. */
export function InstallBanner({ appName }: { appName: string }) {
  const { t } = useTranslation();
  const offer = useSyncExternalStore(subscribeInstall, canPrompt, () => false);
  const [closed, setClosed] = useState(dismissedRecently);
  const ios = isIos();
  if (closed || isStandalone() || (!offer && !ios)) return null;
  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // not remembered in a private window
    }
  };
  return (
    <div
      role="region"
      aria-label={t('pwa.install', { app: appName })}
      className="mb-4 flex items-center gap-3 rounded-card border bg-card p-3 shadow-sm"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary text-primary-foreground">
        {ios ? <Share className="size-5" /> : <Download className="size-5" />}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">{t('pwa.install', { app: appName })}</div>
        <div className="text-muted-foreground">{ios ? t('pwa.iosHint') : t('pwa.hint')}</div>
      </div>
      {!ios && (
        <Button size="sm" onClick={() => void promptInstall().then((ok) => ok && close())}>
          {t('pwa.installButton')}
        </Button>
      )}
      <Button size="icon-sm" variant="ghost" aria-label={t('common.close')} onClick={close}>
        <X />
      </Button>
    </div>
  );
}
