import { Check, Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export type TempPassword = { name: string; code?: string; login?: string | null; tempPassword: string };

/** One-time passwords are shown exactly once; the admin shares them, the person must change it on first login. */
export function TempPasswords({ items, onClose }: { items: TempPassword[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<number | null>(null);
  const copy = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  };
  const all = items.map((p) => `${p.name}${p.login ? ` (${p.login})` : ''}: ${p.tempPassword}`).join('\n');
  return (
    <Dialog
      open={items.length > 0}
      onOpenChange={(o) => !o && onClose()}
      title={t('org.users.tempTitle')}
      description={t('org.users.tempBody')}
      footer={
        <>
          {items.length > 1 && (
            <Button onClick={() => copy(all, -1)}>
              {copied === -1 ? <Check /> : <Copy />} {t('org.users.copyAll')}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('org.done')}
          </Button>
        </>
      }
    >
      <ul className="space-y-2 pb-2">
        {items.map((p, i) => (
          <li key={i} className="flex items-center gap-3 rounded-control border p-3">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{p.name}</div>
              {p.login && <div className="truncate text-xs text-muted-foreground">{p.login}</div>}
            </div>
            <code className="select-all rounded-md bg-muted px-2 py-1 font-mono text-sm">
              {p.tempPassword}
            </code>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => copy(p.tempPassword, i)}
              aria-label={t('org.users.copy')}
            >
              {copied === i ? <Check /> : <Copy />}
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
