import { ArrowRight, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';

/** "Something needs action" strip, e.g. "9 pieces of work have no Buddy today" → Open the cover board. */
export function AlertBanner({ text, action, to }: { text: string; action: string; to: string }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-card border border-status-warn/30 bg-status-warn-bg p-4 text-status-warn-fg sm:flex-row sm:items-center"
    >
      <TriangleAlert className="size-5 shrink-0" aria-hidden />
      <p className="flex-1 text-sm font-medium">{text}</p>
      <Link
        to={to}
        className="inline-flex h-9 items-center justify-center gap-1.5 self-start rounded-control bg-card px-3.5 text-sm font-semibold text-foreground shadow-sm sm:self-auto"
      >
        {action} <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
