import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 w-full min-w-0 rounded-control border border-input bg-card px-3 text-base text-foreground shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 aria-invalid:border-status-bad aria-invalid:ring-status-bad/20 disabled:opacity-50 sm:h-10 sm:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />;
}

export function FieldError({ children }: { children?: string | undefined }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-status-bad-fg">
      {children}
    </p>
  );
}
