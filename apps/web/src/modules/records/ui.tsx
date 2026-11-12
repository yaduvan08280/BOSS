import { Button as BaseButton, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The shared Button, never smaller than 44 px under 768 px wide (a thumb-sized target on phones, CLAUDE.md §3.1).
 * Record screens use this one, so small and icon buttons grow on phones and stay as designed on a desktop.
 */
export function Button({ className, size, variant, ...props }: ButtonProps) {
  const icon = size === 'icon' || size === 'icon-sm';
  return (
    <BaseButton
      size={size}
      variant={variant}
      className={cn(variant !== 'link' && (icon ? 'max-md:size-11' : 'max-md:h-11'), className)}
      {...props}
    />
  );
}
