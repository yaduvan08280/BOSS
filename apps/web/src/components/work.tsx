import { Who } from '@/components/brand';
import type { ReactNode } from 'react';
import { ScrollRow } from '@/components/scroll-row';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
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
    <ScrollRow watch={active}>
      <div className="flex w-max gap-1 border-b">
        {tabs.map((k) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            data-current={active === k}
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
    </ScrollRow>
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
            {e.actorId ? <Who id={e.actorId} name={names.get(e.actorId) ?? '?'} /> : 'MONO'}
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

/** "Slip or ticket?" — shown where people raise either, so they pick the right one. */
export function SlipOrTicket({ current }: { current: 'slip' | 'ticket' }) {
  const { t } = useTranslation();
  const other = current === 'slip' ? 'ticket' : 'slip';
  return (
    <div className="max-w-3xl rounded-card border border-dashed bg-muted/40 p-4 text-sm">
      <p className="font-semibold">{t(`work.which.${current}Title`)}</p>
      <p className="mt-1 text-muted-foreground">{t(`work.which.${current}Body`)}</p>
      <p className="mt-2 text-muted-foreground">
        {t(`work.which.${other}Instead`)}{' '}
        <Link
          to={other === 'slip' ? '/help-slips?tab=raise' : '/help-tickets?tab=raise'}
          className="font-semibold text-foreground underline"
        >
          {t(`work.which.${other}Link`)}
        </Link>
      </p>
    </div>
  );
}
