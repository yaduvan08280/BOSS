import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
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

type Face = { id: string; name: string; avatarUrl: string | null };

/**
 * A person's photo, else their initials. Without a `url` the photo is looked up in the people list the
 * app already keeps (by `id`, else by a name only one person has), so every place that shows a person
 * shows their photo.
 */
export function Avatar({
  name,
  url,
  id,
  className,
}: {
  name: string;
  url?: string | null;
  id?: string | null;
  className?: string;
}) {
  const people = useQuery({
    queryKey: ['org', 'users'],
    queryFn: () => api<Face[]>('/api/org/users'),
    enabled: url === undefined,
    staleTime: 5 * 60_000,
    retry: false,
  }).data;
  const [broken, setBroken] = useState<string | null>(null);
  let src = url ?? null;
  if (url === undefined && people) {
    const byId = id ? people.find((p) => p.id === id) : undefined;
    const sameName = byId ? [] : people.filter((p) => p.name === name);
    src = byId?.avatarUrl ?? (sameName.length === 1 ? sameName[0]!.avatarUrl : null);
  }
  if (src && src !== broken)
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setBroken(src)}
        className={cn('size-9 shrink-0 rounded-full object-cover', className)}
      />
    );
  const letters = initials(name);
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

/** A person's name with their small photo in front (looked up by `id`, else by name). */
export function Who({ id, name, className }: { id?: string | null; name?: string | null; className?: string }) {
  if (!name) return <span className={className}>—</span>;
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 align-middle', className)}>
      <Avatar id={id} name={name} className="size-5 text-[9px]" />
      <span className="truncate">{name}</span>
    </span>
  );
}
