import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 3000)),
  ]);
}

/** Web push for this device (works in the installed app / production build, where the service worker runs). */
export function PhoneNotifications() {
  const { t } = useTranslation();
  const [state, setState] = useState<'checking' | 'unsupported' | 'off' | 'on' | 'blocked'>('checking');
  useEffect(() => {
    void (async () => {
      const reg = await registration();
      if (!reg) return setState('unsupported');
      if (Notification.permission === 'denied') return setState('blocked');
      setState((await reg.pushManager.getSubscription()) ? 'on' : 'off');
    })();
  }, []);

  const turnOn = async () => {
    const reg = await registration();
    if (!reg) return;
    const { publicKey } = await api<{ publicKey: string | null }>('/api/notify/push/key');
    if (!publicKey) return toast.error(t('notify.push.noKeys'));
    if ((await Notification.requestPermission()) !== 'granted') return setState('blocked');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await api('/api/notify/push/subscribe', { method: 'POST', body: sub.toJSON() });
    setState('on');
    toast.success(t('notify.push.on'));
  };
  const turnOff = async () => {
    const sub = await (await registration())?.pushManager.getSubscription();
    if (sub) {
      await api('/api/notify/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    setState('off');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" /> {t('notify.push.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t(`notify.push.state.${state}`)}</p>
        {state === 'off' && (
          <Button variant="primary" onClick={() => void turnOn()}>
            {t('notify.push.turnOn')}
          </Button>
        )}
        {state === 'on' && <Button onClick={() => void turnOff()}>{t('notify.push.turnOff')}</Button>}
      </CardContent>
    </Card>
  );
}
