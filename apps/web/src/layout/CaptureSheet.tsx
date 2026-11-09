import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ListTodo, Loader2, NotebookPen, Plus, Ticket } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { hasPermission, type Me, type PermissionKey } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { api, ApiError } from '@/lib/api';
import { useModuleSettings } from '@/lib/work';

const SHORTCUTS: { key: string; to: string; icon: typeof ListTodo; permission: PermissionKey }[] = [
  { key: 'task', to: '/delegation?tab=add', icon: ListTodo, permission: 'delegation.create' },
  { key: 'slip', to: '/help-slips?tab=raise', icon: NotebookPen, permission: 'slip.create' },
  { key: 'ticket', to: '/help-tickets?tab=raise', icon: Ticket, permission: 'ticket.create' },
];

/**
 * Phone "+ Capture" (CLAUDE.md §3.1): one line onto the EA board for those who keep it (board owner, the EA,
 * EA editors), and shortcuts to give a task, raise a help slip or raise a help ticket for everyone.
 */
export function CaptureSheet({
  me,
  open,
  onOpenChange,
}: {
  me: Me;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const perms = me.user.permissions;
  const ea = useModuleSettings('ea');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // Matches the API: EA view rights, and a role on a board (owner, the chosen EA, or EA edit/admin).
  const mayCapture =
    hasPermission(perms, 'ea.view') &&
    (me.user.roleKey === 'OWNER' || hasPermission(perms, 'ea.edit') || ea.data?.eaUserId === me.user.id);
  const shortcuts = SHORTCUTS.filter((s) => hasPermission(perms, s.permission));

  const capture = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const item = await api<{ number: number }>('/api/ea/items', {
        method: 'POST',
        body: { text: text.trim() },
      });
      toast.success(t('ea.captured', { n: item.number }));
      void qc.invalidateQueries({ queryKey: ['ea'] });
      setText('');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" title={t('shell.capture')}>
        <div className="space-y-4 px-5 pb-8 pt-4">
          {mayCapture && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void capture();
              }}
              className="space-y-2"
            >
              <label className="text-sm font-medium" htmlFor="quick-capture">
                {t('shell.captureEa')}
              </label>
              <div className="flex gap-2">
                <input
                  id="quick-capture"
                  autoFocus
                  value={text}
                  maxLength={500}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('ea.capturePh')}
                  className="h-11 min-w-0 flex-1 rounded-control border bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" variant="primary" disabled={!text.trim() || saving}>
                  {saving ? <Loader2 className="animate-spin" /> : <Plus />} {t('ea.capture')}
                </Button>
              </div>
            </form>
          )}
          {shortcuts.length > 0 && (
            <ul className="divide-y overflow-hidden rounded-card border bg-card">
              {shortcuts.map(({ key, to, icon: Icon }) => (
                <li key={key}>
                  <Link
                    to={to}
                    onClick={() => onOpenChange(false)}
                    className="flex min-h-12 items-center gap-3 px-4 text-sm font-medium hover:bg-muted"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{t(`shell.quick.${key}`)}</span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!mayCapture && !shortcuts.length && (
            <p className="text-sm text-muted-foreground">{t('shell.captureNothing')}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
