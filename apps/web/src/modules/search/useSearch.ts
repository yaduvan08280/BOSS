import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canOpenSystemMaster, type Me } from '@mono/shared';
import { api } from '@/lib/api';
import { ALL_ITEMS, type NavItem } from '@/layout/nav';

export type PeopleHit = {
  id: string;
  code: string;
  name: string;
  status: string;
  designation: string | null;
  department: string | null;
};
export type SearchHit =
  | { kind: 'screen'; id: string; item: NavItem; title: string; subtitle: string; to: string }
  | { kind: 'person'; id: string; title: string; subtitle: string; to: string }
  | { kind: 'department'; id: string; title: string; subtitle: string; to: string };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Screens are matched in the browser (English + current language); people and departments come from the API. */
export function useSearch(q: string, me: Me) {
  const { t } = useTranslation();
  const needle = q.trim().toLowerCase();
  const debounced = useDebounced(needle, 200);
  const admin = canOpenSystemMaster(me.user.permissions);
  const remote = useQuery({
    queryKey: ['search', debounced],
    queryFn: () =>
      api<{ people: PeopleHit[]; departments: { id: string; name: string }[] }>(
        `/api/search?q=${encodeURIComponent(debounced)}`,
      ),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
  return useMemo<SearchHit[]>(() => {
    if (!needle) return [];
    const screens: SearchHit[] = ALL_ITEMS.filter((i) => i.key !== 'uiKit' && (i.tag !== 'setup' || admin))
      .filter((i) =>
        [
          t(`nav.${i.key}`),
          t(`navDesc.${i.key}`),
          t(`nav.${i.key}`, { lng: 'en' }),
          t(`navDesc.${i.key}`, { lng: 'en' }),
          i.key,
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 6)
      .map((i) => ({
        kind: 'screen',
        id: i.key,
        item: i,
        title: t(`nav.${i.key}`),
        subtitle: t(`navDesc.${i.key}`),
        to: i.path,
      }));
    const data = debounced === needle ? remote.data : undefined;
    const people: SearchHit[] = (data?.people ?? []).map((p) => ({
      kind: 'person',
      id: p.id,
      title: p.name,
      subtitle: [p.code, p.designation, p.department].filter(Boolean).join(' · '),
      to: admin ? `/system/org-chart?person=${p.id}` : '/',
    }));
    const departments: SearchHit[] = (data?.departments ?? []).map((d) => ({
      kind: 'department',
      id: d.id,
      title: d.name,
      subtitle: t('search.department'),
      to: admin ? `/system/users?dept=${d.id}` : '/',
    }));
    return [...screens, ...people, ...departments];
  }, [needle, debounced, remote.data, admin, t]);
}
