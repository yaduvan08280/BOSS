import { Switch as S } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const field =
  'w-full min-w-0 rounded-control border border-input bg-card px-3 text-base text-foreground outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 aria-invalid:border-status-bad disabled:opacity-50 sm:text-sm';

/** Type-to-filter dropdown (drop-in for a native select). */
export { Select } from './select';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-28 py-2.5 font-mono text-sm', className)} {...props} />;
}

export function Switch({ className, ...props }: ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-pill border-2 border-transparent bg-border transition-colors data-[state=checked]:bg-primary disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-5 rounded-full bg-card shadow transition-transform data-[state=checked]:translate-x-5" />
    </S.Root>
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn('size-[18px] cursor-pointer rounded accent-[var(--primary)]', className)}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {error && (
        <span role="alert" className="block text-sm text-status-bad-fg">
          {error}
        </span>
      )}
    </label>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'tabular inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}
