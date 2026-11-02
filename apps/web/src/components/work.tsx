import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { formatShortDateTime } from '@/lib/when';

/** The underlined tab strip used on every work screen; scrolls sideways on phones. */
export function TabStrip<T extends string>({
  tabs,
  active,
  onChange,
  label,
  counts,
}: {
  tabs: readonly T[];
  active: T;
  onChange: (t: T) => void;
  label: (t: T) => string;
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <nav className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div className="flex w-max gap-1 border-b">
        {tabs.map((k) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={cn(
              '-mb-px flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium',
              active === k
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label(k)}
            {counts?.[k] !== undefined && <Badge>{counts[k]}</Badge>}
          </button>
        ))}
      </div>
    </nav>
  );
}

export type TimelineEvent = {
  id: string;
  type: string;
  actorId: string | null;
  note: string | null;
  createdAt: string;
};

/** History of a record, newest last: who did what, when, and what they wrote. */
export function Timeline<E extends TimelineEvent>({
  events,
  names,
  tz,
  describe,
}: {
  events: E[];
  names: Map<string, string>;
  tz: string;
  describe: (e: E) => ReactNode;
}) {
  return (
    <ol className="space-y-3 border-l pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative text-sm">
          <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
          <div className="text-xs text-muted-foreground">
            <span className="tabular">{formatShortDateTime(e.createdAt, tz)}</span>
            {' · '}
            {e.actorId ? (names.get(e.actorId) ?? '?') : 'MONO'}
          </div>
          <div className="font-medium">{describe(e)}</div>
          {e.note && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Label/value rows in drawers. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
