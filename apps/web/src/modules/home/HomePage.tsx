import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Search, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { canOpenSystemMaster, type Me, type SystemSummary } from '@mono/shared';
import { AlertBanner } from '@/components/alert-banner';
import { api } from '@/lib/api';
import { cn, firstName } from '@/lib/utils';
import { ALL_ITEMS, type NavItem } from '@/layout/nav';
import { ME_KEY } from '@/modules/auth/session';
import { SearchResults } from '@/modules/search/SearchResults';
import { handleListKeys } from '@/modules/search/keys';
import { useSearch } from '@/modules/search/useSearch';

const CHIPS = [
  'all',
  'businessEngine',
  'systems',
  'hr',
  'salesCrm',
  'masters',
  'messaging',
  'workspace',
] as const;
type Chip = (typeof CHIPS)[number];

function useHomeAlert(admin: boolean) {
  const { t } = useTranslation();
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api<SystemSummary>('/api/system/summary'),
    enabled: admin,
  });
  const gaps = new Map(summary.data?.health.gaps.map((g) => [g.key, g.count]) ?? []);
  if (gaps.get('departmentsWithoutHod'))
    return {
      text: t('home.alert.noHod', { count: gaps.get('departmentsWithoutHod') }),
      action: t('home.alert.openOrgChart'),
      to: '/system/org-chart',
    };
  if (gaps.get('peopleWithoutDepartment'))
    return {
      text: t('home.alert.noDept', { count: gaps.get('peopleWithoutDepartment') }),
      action: t('home.alert.openUsers'),
      to: '/system/users?dept=none',
    };
  return null;
}

export function HomePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [chip, setChip] = useState<Chip>('all');
  const admin = canOpenSystemMaster(me.user.permissions);
  const hits = useSearch(q, me);
  const alert = useHomeAlert(admin);
  const favourites = me.user.favourites;

  const toggleFavourite = async (key: string) => {
    const next = favourites.includes(key) ? favourites.filter((f) => f !== key) : [...favourites, key];
    qc.setQueryData<Me>(ME_KEY, (old) => (old ? { ...old, user: { ...old.user, favourites: next } } : old));
    await api('/api/auth/me/favourites', { method: 'PUT', body: { favourites: next } }).catch(() =>
      qc.invalidateQueries({ queryKey: ME_KEY }),
    );
  };

  const items = useMemo(() => {
    const visible = ALL_ITEMS.filter(
      (i) =>
        i.key !== 'home' && i.key !== 'uiKit' && (i.tag !== 'setup' && i.tag !== 'messaging' ? true : admin),
    );
    const inChip = visible.filter((i) => (chip === 'all' ? i.tag !== 'setup' : i.tag === chip));
    const rank = (i: NavItem) => (favourites.includes(i.key) ? 0 : 1);
    return [...inChip].sort((a, b) => rank(a) - rank(b));
  }, [chip, favourites, admin]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="pt-2 sm:pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-4xl">
          {t('home.heading', { name: firstName(me.user.name) })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t('home.hint')}</p>
      </div>

      <div className="relative mt-6">
        <label className="flex h-14 items-center gap-3 rounded-card border bg-card px-4 shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
          <Search className="size-5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            onKeyDown={(e) =>
              handleListKeys(e, {
                count: hits.length,
                setActive,
                onEnter: () => hits[active] && navigate(hits[active].to),
                onEscape: () => setQ(''),
              })
            }
            placeholder={t('home.searchPlaceholder')}
            aria-label={t('search.title')}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:block">
            Ctrl K
          </kbd>
        </label>
        {q.trim() && (
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-20 max-h-[60dvh] overflow-y-auto rounded-card border bg-popover shadow-xl">
            <SearchResults hits={hits} active={active} q={q} onPick={() => setQ('')} />
          </div>
        )}
      </div>

      {alert && (
        <div className="mt-5">
          <AlertBanner {...alert} />
        </div>
      )}

      <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {CHIPS.filter((c) => c !== 'messaging' || admin).map((c) => (
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
            {c === 'all' ? t('home.all') : t(`home.chip.${c}`)}
          </button>
        ))}
      </div>

      <h2 className="mb-3 mt-7 text-sm font-semibold text-muted-foreground">{t('home.suggested')}</h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((i) => {
          const fav = favourites.includes(i.key);
          return (
            <li key={i.key} className="relative min-w-0">
              <Link
                to={i.path}
                className="group flex items-center gap-3.5 rounded-card border bg-card p-3.5 pr-12 transition-colors hover:border-ring/40 hover:bg-muted/50"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-soft-foreground">
                  <i.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium">{t(`nav.${i.key}`)}</span>
                    <span className="shrink-0 rounded-pill bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t(`home.chip.${i.tag === 'setup' ? 'setup' : i.tag}`)}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t(`navDesc.${i.key}`)}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
              <button
                onClick={() => void toggleFavourite(i.key)}
                aria-pressed={fav}
                aria-label={t(fav ? 'home.unstar' : 'home.star')}
                className="absolute right-3 top-3 grid size-8 place-items-center rounded-control text-muted-foreground hover:bg-muted"
              >
                <Star className={cn('size-4', fav && 'fill-accent text-accent')} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
