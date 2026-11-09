import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export type ShownCode = { name: string; code: string };

/** Telegram link codes for people with no mobile or email: the admin hands these over in person. */
export function ShownCodes({ codes, onClose }: { codes: ShownCode[]; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={codes.length > 0}
      onOpenChange={(o) => !o && onClose()}
      title={t('notify.tg.shownTitle')}
      description={t('notify.tg.shownBody')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('org.done')}
        </Button>
      }
    >
      <ul className="space-y-2 pb-2">
        {codes.map((s) => (
          <li key={s.code} className="flex items-center justify-between rounded-control border p-3 text-sm">
            {s.name}
            <code className="select-all rounded-md bg-muted px-2 py-1 font-mono">{s.code}</code>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
