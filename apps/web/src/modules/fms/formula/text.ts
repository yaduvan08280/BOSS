import type { TFunction } from 'i18next';
import type { FormulaProblem } from '@mono/shared';

/** A formula problem as one sentence in the person's language. */
export const problemText = (t: TFunction, p: FormulaProblem): string =>
  t(`formula.p.${p.code}`, { name: p.name ?? '', other: p.other ?? '' });
