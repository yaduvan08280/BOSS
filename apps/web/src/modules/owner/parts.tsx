import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Column<T> = {
  key: string;
  label: string;
  /** Right-aligned numbers. */
  num?: boolean;
  cell: (row: T) => ReactNode;
  /** Shown as the card's heading on a phone (the first column when none is marked). */
  head?: boolean;
};

/** A table on a desk, a list of cards on a phone — one definition for both. */
export function DataList<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T, i: number) => string;
  empty?: string;
}) {
  if (!rows.length)
    return empty ? (
      <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">{empty}</p>
    ) : null;
  const head = columns.find((c) => c.head) ?? columns[0]!;
  const rest = columns.filter((c) => c !== head);
  return (
    <>
      <div className="hidden overflow-x-auto rounded-card border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn('px-3 py-2.5 font-medium whitespace-nowrap', c.num && 'text-right')}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={rowKey(r, i)} className="hover:bg-muted/40">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn('px-3 py-2 align-top', c.num && 'tabular text-right whitespace-nowrap')}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((r, i) => (
          <li key={rowKey(r, i)} className="rounded-card border bg-card p-3.5 text-sm">
            <div className="font-semibold">{head.cell(r)}</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {rest.map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="text-[11px] text-muted-foreground">{c.label}</dt>
                  <dd className="tabular truncate">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A number that is outside its range is shown in the "bad" status colours with a mark, never by colour alone. */
export function Flagged({ bad, children }: { bad: boolean; children: ReactNode }) {
  return bad ? (
    <span className="rounded-pill bg-status-bad-bg px-1.5 py-0.5 font-semibold text-status-bad-fg">
      ▲ {children}
    </span>
  ) : (
    <>{children}</>
  );
}

export function Section({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
