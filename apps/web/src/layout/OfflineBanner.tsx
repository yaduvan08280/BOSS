import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * No internet (a phone in the store room, the line down): say so at once, instead of screens that keep
 * spinning and a save that seems to do nothing. It goes away by itself when the connection is back.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-status-warn-bg px-4 py-2 text-center text-sm font-medium text-status-warn-fg"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      {t('shell.offline')}
    </div>
  );
}
