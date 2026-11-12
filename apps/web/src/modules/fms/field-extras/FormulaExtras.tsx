import { useContext, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkFormula,
  FORMULA_FUNCTIONS,
  FORMULA_MAX_LENGTH,
  formulaCanRead,
  formulaGives,
  type FlowField,
} from '@mono/shared';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { workedExample } from '../formula/example';
import { KnownFields, useCompanyTz } from '../formula/known';
import { problemText } from '../formula/text';
import { showValue } from '../show';
import type { ExtrasProps } from './types';

const SIGNS = ['+', '−', '×', '÷', '%', '(', ')'];
const HELP = ['intro', 'math', 'percent', 'dates', 'blank', 'round'] as const;
const chip =
  'inline-flex min-h-11 items-center rounded-pill border bg-card px-3 text-sm hover:border-primary sm:min-h-8';

/** Formula (§2.3): the expression, checked as it is typed, with the fields it may use and a worked example. */
export function FormulaExtras(p: ExtrasProps) {
  return p.field.type === 'formula' ? <FormulaEditor {...p} /> : null;
}

function FormulaEditor({ field, fields, onChange }: ExtrasProps) {
  const { t } = useTranslation();
  const id = useId();
  const tz = useCompanyTz();
  const known = useContext(KnownFields);
  const input = useRef<HTMLInputElement>(null);
  const expr = field.formula ?? '';
  // The form's own fields last: they win over a field of the same key on the start form or an earlier step.
  const scope = useMemo(() => [...known, ...fields], [known, fields]);
  const problem = useMemo(() => checkFormula(expr, scope, field.key), [expr, scope, field.key]);
  const usable = (f: FlowField) => f.key !== field.key && formulaCanRead(f.type);
  const own = fields.filter(usable);
  const ownKeys = new Set(fields.map((f) => f.key));
  const earlier = [...new Map(known.map((f) => [f.key, f])).values()].filter(
    (f) => usable(f) && !ownKeys.has(f.key),
  );

  /** Put a field, a sign or a function where the cursor is. */
  const insert = (text: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? expr.length;
    const before = expr.slice(0, start);
    const after = expr.slice(el?.selectionEnd ?? start);
    const lead = before && !/[\s(]$/.test(before) && text !== ')' && text !== '%' ? ' ' : '';
    const tail = text.endsWith('(') || /^\s/.test(after) ? '' : ' ';
    const placed = `${before}${lead}${text}${tail}`;
    onChange({ formula: `${placed}${after}`.slice(0, FORMULA_MAX_LENGTH) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(placed.length, placed.length);
    });
  };
  const fieldChips = (list: FlowField[]) =>
    list.map((f) => (
      <button
        key={f.key}
        type="button"
        className={chip}
        title={f.key}
        onClick={() => insert(f.type === 'items' ? `sum(${f.key})` : f.key)}
      >
        {f.label}
      </button>
    ));

  return (
    <div className="space-y-2 rounded-control bg-muted/60 p-3">
      <label htmlFor={id} className="block text-sm font-medium">
        {t('formula.label')}
      </label>
      <Input
        id={id}
        ref={input}
        className="font-mono"
        value={expr}
        maxLength={FORMULA_MAX_LENGTH}
        placeholder={t('formula.placeholder')}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={Boolean(problem) && expr.trim() !== ''}
        aria-describedby={`${id}-state`}
        onChange={(e) => onChange({ formula: e.target.value || undefined })}
      />
      <div id={`${id}-state`} aria-live="polite" className="space-y-1 text-sm">
        {!problem ? (
          <Worked field={field} scope={scope} tz={tz} />
        ) : expr.trim() === '' ? (
          <p className="text-muted-foreground">{t('formula.hint')}</p>
        ) : (
          <div role="alert" className="text-status-bad-fg">
            <p>{problemText(t, problem)}</p>
            {problem.end > problem.at && (
              <p className="break-all font-mono text-xs">
                <span className="font-sans">{t('formula.at')} </span>
                {expr.slice(0, problem.at)}
                <mark className="rounded bg-status-bad-bg px-0.5 font-bold text-status-bad-fg underline">
                  {expr.slice(problem.at, problem.end)}
                </mark>
                {expr.slice(problem.end)}
              </p>
            )}
          </div>
        )}
      </div>

      <p className="pt-1 text-xs font-medium text-muted-foreground">{t('formula.fields')}</p>
      {own.length + earlier.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('formula.noFields')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">{fieldChips(own)}</div>
      )}
      {earlier.length > 0 && (
        <>
          <p className="text-xs font-medium text-muted-foreground">{t('formula.known')}</p>
          <div className="flex flex-wrap gap-1.5">{fieldChips(earlier)}</div>
        </>
      )}
      <p className="pt-1 text-xs font-medium text-muted-foreground">{t('formula.signs')}</p>
      <div className="flex flex-wrap gap-1.5">
        {SIGNS.map((s) => (
          <button
            key={s}
            type="button"
            className={cn(chip, 'min-w-11 justify-center sm:min-w-8')}
            onClick={() => insert(s)}
          >
            {s}
          </button>
        ))}
        {FORMULA_FUNCTIONS.map((fn) => (
          <button
            key={fn}
            type="button"
            className={cn(chip, 'font-mono')}
            title={t(`formula.fn.${fn}`)}
            onClick={() => insert(`${fn}(`)}
          >
            {fn}( )
          </button>
        ))}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium sm:min-h-8">
          {t('formula.help.title')}
        </summary>
        <ul className="space-y-1 pb-1">
          {HELP.map((k) => (
            <li key={k}>{t(`formula.help.${k}`)}</li>
          ))}
          {FORMULA_FUNCTIONS.map((fn) => (
            <li key={fn} className="break-words">
              {t(`formula.fn.${fn}`)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** A formula that works: what it gives, and one worked example on believable values. */
function Worked({ field, scope, tz }: { field: FlowField; scope: FlowField[]; tz: string }) {
  const { t } = useTranslation();
  const gives = formulaGives(field.formula ?? '', scope, field.key);
  const example = useMemo(
    () => workedExample(field, scope, tz, t('formula.sampleText')),
    [field, scope, tz, t],
  );
  const yesNo: [string, string] = [t('fms.yes'), t('fms.no')];
  const show = (f: FlowField, v: unknown) =>
    Array.isArray(v) && f.type === 'items'
      ? t('formula.itemLines', { count: v.length })
      : (showValue(f, v, tz, yesNo) ?? '—');
  return (
    <>
      <p className="text-status-ok-fg">
        ✓ {t('formula.ok')} {gives && t(`formula.gives.${gives}`)}
      </p>
      <p className="break-words text-muted-foreground">
        {t('formula.example')}:{' '}
        {example.inputs.map(({ field: f, value }) => `${f.label} ${show(f, value)}`).join(' · ')}
        {example.inputs.length > 0 && ' → '}
        <strong className="tabular text-foreground">
          {example.result === null ? t('formula.exampleNone') : show(field, example.result)}
        </strong>
      </p>
    </>
  );
}
