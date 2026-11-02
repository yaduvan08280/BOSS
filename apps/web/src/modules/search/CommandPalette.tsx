import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { handleListKeys } from './keys';
import { SearchResults } from './SearchResults';
import { useSearch } from './useSearch';

/** Ctrl/Cmd+K anywhere: jump to a screen, a person or a department. */
export function CommandPalette({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const hits = useSearch(q, me);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mono:search', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mono:search', onOpen);
    };
  }, []);
  const close = () => {
    setOpen(false);
    setQ('');
  };

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <SheetContent
        side="center"
        title={t('search.title')}
        hideTitle
        className="top-[12vh] max-h-[76dvh] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <label className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Search className="size-5 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) =>
              handleListKeys(e, {
                count: hits.length,
                setActive,
                onEnter: () => {
                  if (!hits[active]) return;
                  navigate(hits[active].to);
                  close();
                },
              })
            }
            placeholder={t('home.searchPlaceholder')}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none"
          />
          <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            Esc
          </kbd>
        </label>
        <div className="min-h-0 overflow-y-auto">
          {q.trim() ? (
            <SearchResults hits={hits} active={active} onPick={close} q={q} />
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">{t('home.hint')}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
