import { ArrowRight, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { cn, firstName } from '@/lib/utils';
import { ALL_ITEMS, type NavItem } from '@/layout/nav';

const CHIPS: (NavItem['tag'] | 'all')[] = [
  'all',
  'businessEngine',
  'systems',
  'hr',
  'inventory',
  'salesCrm',
  'masters',
  'workspace',
];

export function HomePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [chip, setChip] = useState<(typeof CHIPS)[number]>('all');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ALL_ITEMS.filter((i) => i.tag !== 'setup' && i.key !== 'home')
      .filter((i) => chip === 'all' || i.tag === chip)
      .filter(
        (i) =>
          !needle ||
          [t(`nav.${i.key}`), t(`navDesc.${i.key}`), i.key, t(`nav.${i.key}`, { lng: 'en' })]
            .join(' ')
            .toLowerCase()
            .includes(needle),
      );
  }, [q, chip, t]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="pt-2 sm:pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-4xl">
          {t('home.heading', { name: firstName(me.user.name) })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t('home.hint')}</p>
      </div>

      <label className="mt-6 flex h-14 items-center gap-3 rounded-card border bg-card px-4 shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
        <Search className="size-5 text-muted-foreground" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('home.searchPlaceholder')}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:block">
          Ctrl K
        </kbd>
      </label>

      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => setChip(c)}
            className={cn(
              'h-9 shrink-0 rounded-pill border px-4 text-sm font-medium transition-colors',
              chip === c
                ? 'border-ink bg-ink text-ink-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {c === 'all' ? t('home.all') : t(c === 'workspace' ? 'section.workspace' : `section.${c}`)}
          </button>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">{t('home.suggested')}</h2>
      {items.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          {t('home.noMatch', { q })}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.key} className="min-w-0">
              <Link
                to={i.path}
                className="group flex items-center gap-3.5 rounded-card border bg-card p-3.5 transition-colors hover:border-ring/40 hover:bg-muted/50"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-soft-foreground">
                  <i.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{t(`nav.${i.key}`)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t(`navDesc.${i.key}`)}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
