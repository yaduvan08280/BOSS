import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** One wizard question: the question, a hint, and the answer controls (CLAUDE.md §9.1). */
export function Question({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2 border-b py-4 last:border-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** Preset chips; the chosen one is dark. */
export function Chips<T extends string | number | boolean>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-9 rounded-pill border px-3.5 text-sm font-medium',
            value === o.value
              ? 'border-ink bg-ink text-ink-foreground'
              : 'bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Preset chips plus a −/+ stepper for any other number. */
export function NumberChoice({
  value,
  presets,
  onChange,
  label,
  unit,
  step = 1,
  min = 0,
  max = 999,
  show = (n) => String(n),
}: {
  value: number;
  presets: number[];
  onChange: (v: number) => void;
  label: string;
  unit: string;
  step?: number;
  min?: number;
  max?: number;
  show?: (n: number) => string;
}) {
  const { t } = useTranslation();
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 100) / 100));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Chips
        value={value}
        options={presets.map((p) => ({ value: p, label: `${show(p)} ${unit}` }))}
        onChange={onChange}
        label={label}
      />
      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label={t('hr.w.less')}
          onClick={() => onChange(clamp(value - step))}
        >
          <Minus />
        </Button>
        <span className="min-w-16 text-center text-sm font-semibold tabular-nums">
          {show(value)} {unit}
        </span>
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label={t('hr.w.more')}
          onClick={() => onChange(clamp(value + step))}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

export function YesNo({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <Chips
      value={value}
      label={label}
      onChange={onChange}
      options={[
        { value: true, label: t('common.yes') },
        { value: false, label: t('common.no') },
      ]}
    />
  );
}
