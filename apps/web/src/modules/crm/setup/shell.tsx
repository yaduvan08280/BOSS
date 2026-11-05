import { Loader2, Save } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { inrInWords } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toPaise } from '../api';

/** One setup page: its title, a hint, the content and a Save button (disabled while the plan is locked). */
export function SetupCard({
  title,
  hint,
  children,
  onSave,
  saving,
  locked,
  saveLabel,
  dirty = true,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  onSave?: () => void;
  saving?: boolean;
  locked?: boolean;
  saveLabel?: string;
  dirty?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
        {children}
        {onSave && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
            {locked && <span className="text-sm text-muted-foreground">{t('crm.s.locked')}</span>}
            <Button disabled={locked || saving || !dirty} onClick={onSave}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} {saveLabel ?? t('crm.s.saveNext')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Rupees typed with Indian grouping; shows the amount in words ("₹5 crore"). */
export function MoneyInput({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const p = toPaise(value);
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">₹</span>
        <Input
          aria-label={label}
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="tabular-nums"
        />
      </div>
      {p !== null && p > 0 && <div className="text-xs text-muted-foreground">{inrInWords(p)}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  big,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  big?: boolean;
}) {
  return (
    <div className={cn('rounded-card border bg-card p-3', big && 'bg-ink text-ink-foreground')}>
      <div className={cn('text-xs', big ? 'opacity-80' : 'text-muted-foreground')}>{label}</div>
      <div className={cn('font-semibold tabular-nums', big ? 'text-2xl' : 'text-lg')}>{value}</div>
      {sub && <div className={cn('text-xs', big ? 'opacity-80' : 'text-muted-foreground')}>{sub}</div>}
    </div>
  );
}
