import { cn, initials } from '@/lib/utils';

/** App mark: the company logo if set, else an accent tile with the app's initial. */
export function BrandMark({
  appName,
  logoUrl,
  className,
}: {
  appName: string;
  logoUrl?: string | null;
  className?: string;
}) {
  if (logoUrl)
    return <img src={logoUrl} alt="" className={cn('size-9 rounded-control object-cover', className)} />;
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-control bg-accent text-base font-bold text-accent-foreground',
        className,
      )}
    >
      {appName.trim()[0]?.toUpperCase() ?? 'M'}
    </span>
  );
}

export function Avatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  const letters = initials(name);
  if (url) return <img src={url} alt="" className={cn('size-9 rounded-full object-cover', className)} />;
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-foreground',
        className,
      )}
    >
      {letters}
    </span>
  );
}
