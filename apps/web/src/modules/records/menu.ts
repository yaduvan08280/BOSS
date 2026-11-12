import { Shapes } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import type { NavItem, NavSection } from '@/layout/nav';
import { useRecordMenu } from './api';
import { RECORD_ICON } from './icons';

/** A menu entry that brings its own words (a record type's name) instead of a `nav.*` string. */
export type MenuItem = NavItem & { label?: string };
export type MenuSection = { key: string; label?: string; items: MenuItem[] };

/** Left-menu sections a record type can be placed in (besides a section of its own). */
export const RECORD_MENU_SECTIONS = ['businessEngine', 'systems', 'hr', 'inventory', 'salesCrm', 'masters'];

/**
 * The static menu (`nav.ts`) plus the company's own record types, each where its admin placed it: inside an
 * existing section, or in a section of its own (put before Masters). People with `records.admin` also get
 * "Record types" under Masters. Used by the sidebar and by the phone drawer, which render the same list.
 */
export function useRecordSections(me: Me, base: NavSection[]): MenuSection[] {
  const { t } = useTranslation();
  const entries = useRecordMenu().data;
  const admin = hasPermission(me.user.permissions, 'records.admin');
  return useMemo(() => {
    const sections: MenuSection[] = base.map((s) => ({ ...s, items: [...s.items] }));
    const own: MenuSection[] = [];
    for (const e of entries ?? []) {
      const item: MenuItem = {
        key: `record:${e.id}`,
        path: e.path,
        icon: RECORD_ICON[e.icon] ?? RECORD_ICON['file-text'],
        phase: 0,
        tag: 'masters',
        label: e.name,
      };
      const home =
        sections.find((s) => s.key === e.section && RECORD_MENU_SECTIONS.includes(s.key)) ??
        own.find((s) => s.label === e.section);
      if (home) home.items.push(item);
      else own.push({ key: `records:${e.section}`, label: e.section, items: [item] });
    }
    const masters = sections.findIndex((s) => s.key === 'masters');
    if (masters < 0) return [...sections, ...own];
    if (admin)
      sections[masters]!.items.push({
        key: 'recordTypes',
        path: '/records/types',
        icon: Shapes,
        phase: 0,
        tag: 'masters',
        label: t('records.types.title'),
      });
    sections.splice(masters, 0, ...own);
    return sections;
  }, [base, entries, admin, t]);
}

/** The top bar's title on record screens (they are not in the static menu). */
export function useRecordPageTitle(pathname: string): { title: string; subtitle?: string } | null {
  const { t } = useTranslation();
  const entries = useRecordMenu().data;
  if (!pathname.startsWith('/records')) return null;
  if (pathname.startsWith('/records/types'))
    return { title: t('records.types.title'), subtitle: t('records.types.subtitle') };
  const entry = entries?.find((e) => pathname === e.path || pathname.startsWith(`${e.path}/`));
  return { title: entry?.name ?? t('records.title'), subtitle: t('records.subtitle') };
}
