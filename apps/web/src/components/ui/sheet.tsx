import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

const panel = cva('fixed z-50 flex flex-col bg-card text-card-foreground shadow-2xl outline-none', {
  variants: {
    side: {
      left: 'inset-y-0 left-0 h-dvh w-[86vw] max-w-80',
      right: 'inset-y-0 right-0 h-dvh w-[92vw] max-w-md border-l',
      bottom: 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[calc(var(--radius)+6px)] border-t pb-safe',
      center:
        'left-1/2 top-1/2 max-h-[88dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-card border',
    },
  },
  defaultVariants: { side: 'right' },
});

type SheetContentProps = Omit<ComponentProps<typeof D.Content>, 'title'> &
  VariantProps<typeof panel> & { title: ReactNode; description?: ReactNode; hideTitle?: boolean };

/** Side drawer, bottom sheet (phones) or centred dialog — one component, same behaviour. */
export function SheetContent({
  className,
  side,
  title,
  description,
  hideTitle,
  children,
  ...props
}: SheetContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
      <D.Content className={cn(panel({ side }), className)} aria-describedby={undefined} {...props}>
        {side === 'bottom' && <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border" />}
        <div className={cn('flex items-start justify-between gap-3 px-5 pt-4', hideTitle && 'sr-only')}>
          <div className="min-w-0">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description && (
              <D.Description className="mt-0.5 text-sm text-muted-foreground">{description}</D.Description>
            )}
          </div>
          <D.Close className="-mr-2 grid size-9 place-items-center rounded-control text-muted-foreground hover:bg-muted">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
