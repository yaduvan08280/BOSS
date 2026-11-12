import { Sigma } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { computeFormulas } from '@mono/shared';
import { useCompanyTz } from '../formula/known';
import { showValue } from '../show';
import type { InputProps } from './ctx';

/**
 * A formula field (§2.3): read-only, worked out as the other fields change — by the same shared function the
 * server uses when the form is saved. What is shown here is never sent as the answer; the server works it out again.
 */
export function FormulaValue({ field, ctx }: InputProps) {
  const { t } = useTranslation();
  const tz = useCompanyTz();
  const value = computeFormulas(ctx.fields, { ...ctx.known, ...ctx.values }, { tz })[field.key];
  const shown = showValue(field, value, tz, [t('fms.yes'), t('fms.no')]);
  return (
    <output
      aria-live="polite"
      className="tabular flex min-h-11 items-center gap-2 rounded-control border border-dashed bg-muted px-3 text-base sm:min-h-10 sm:text-sm"
    >
      <Sigma className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {shown === null ? (
        <span className="text-muted-foreground">{t('formula.empty')}</span>
      ) : (
        <span className="min-w-0 break-words font-semibold">{shown}</span>
      )}
    </output>
  );
}
