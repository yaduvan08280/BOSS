import type { TFunction } from 'i18next';

/** "delegation.assigned" → "Task assigned" (falls back to the raw name for events without a label). */
export function eventLabel(t: TFunction, event: string) {
  const key = `notify.event.${event.replace('.', '_')}`;
  const label = t(key);
  return label === key ? event : label;
}

export function recipientLabel(t: TFunction, r: string, people?: Map<string, string>) {
  if (r.startsWith('user:')) return people?.get(r.slice(5)) ?? t('notify.to.someone');
  return t(`notify.to.${r}`);
}

export const moduleOf = (event: string) => event.split('.')[0]!;
