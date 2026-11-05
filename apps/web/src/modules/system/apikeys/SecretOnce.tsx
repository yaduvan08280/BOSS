import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

/** A key or secret shown once, with a copy button and a warning that it won't be shown again. */
export function SecretOnce({ title, value, onClose }: { title: string; value: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={t('keys.onceHint')}
      footer={<Button onClick={onClose}>{t('keys.savedIt')}</Button>}
    >
      <div className="flex items-center gap-2 rounded-control border bg-muted/50 p-2">
        <code className="min-w-0 flex-1 font-mono text-xs break-all" data-testid="secret-once">
          {value}
        </code>
        <CopyButton value={value} copied={copied} onCopied={() => setCopied(true)} />
      </div>
    </Dialog>
  );
}

export function CopyButton({
  value,
  copied,
  onCopied,
}: {
  value: string;
  copied?: boolean;
  onCopied?: () => void;
}) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const shown = copied ?? done;
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={t('keys.copy')}
      onClick={() =>
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          onCopied?.();
        })
      }
    >
      {shown ? <Check /> : <Copy />}
    </Button>
  );
}
