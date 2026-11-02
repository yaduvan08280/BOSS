import { Blocks, CornerDownLeft, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { SearchHit } from './useSearch';

export function SearchResults({
  hits,
  active,
  onPick,
  q,
}: {
  hits: SearchHit[];
  active: number;
  onPick: () => void;
  q: string;
}) {
  const { t } = useTranslation();
  if (!q.trim()) return null;
  if (hits.length === 0)
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('home.noMatch', { q })}</p>;
  return (
    <ul role="listbox" className="py-1">
      {hits.map((h, i) => {
        const Icon = h.kind === 'screen' ? h.item.icon : h.kind === 'person' ? UserRound : Blocks;
        return (
          <li key={`${h.kind}:${h.id}`} role="option" aria-selected={i === active}>
            <Link
              to={h.to}
              onClick={onPick}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5',
                i === active ? 'bg-muted' : 'hover:bg-muted/60',
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-soft-foreground">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{h.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>
              </span>
              <span className="text-[11px] text-muted-foreground">{t(`search.kind.${h.kind}`)}</span>
              {i === active && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
