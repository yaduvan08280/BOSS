import { DropdownMenu as M } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuGroup = M.Group;
export const DropdownMenuRadioGroup = M.RadioGroup;
export const DropdownMenuSub = M.Sub;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-56 overflow-hidden rounded-card border bg-popover p-1.5 text-popover-foreground shadow-lg',
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

const itemClass =
  'relative flex min-h-10 cursor-default select-none items-center gap-2.5 rounded-control px-2.5 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground';

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof M.Item>) {
  return <M.Item className={cn(itemClass, className)} {...props} />;
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(itemClass, 'pr-8', className)} {...props}>
      {children}
      <M.ItemIndicator className="absolute right-3 size-2 rounded-full bg-accent" />
    </M.RadioItem>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem className={cn(itemClass, 'pr-8', className)} {...props}>
      {children}
      <M.ItemIndicator className="absolute right-3 size-2 rounded-full bg-accent" />
    </M.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('px-2.5 py-1.5 text-xs text-muted-foreground', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn('-mx-1.5 my-1.5 h-px bg-border', className)} {...props} />;
}

export function DropdownMenuSubTrigger({ className, ...props }: ComponentProps<typeof M.SubTrigger>) {
  return <M.SubTrigger className={cn(itemClass, 'data-[state=open]:bg-muted', className)} {...props} />;
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof M.SubContent>) {
  return (
    <M.Portal>
      <M.SubContent
        className={cn(
          'z-50 min-w-44 rounded-card border bg-popover p-1.5 text-popover-foreground shadow-lg',
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}
