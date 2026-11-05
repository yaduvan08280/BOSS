import { cn } from '@/lib/utils';

/**
 * Small charts drawn as SVG (no chart library): bars against a target, a sparkline and a ring. Colours come from
 * the theme's tokens; each chart has a text label for screen readers.
 */
export function Bars({
  data,
  label,
  className,
}: {
  data: { label: string; value: number; target?: number; muted?: boolean; extra?: number }[];
  label: string;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.target ?? 0, d.extra ?? 0)));
  const w = 100 / data.length;
  return (
    <svg
      viewBox="0 0 100 60"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn('h-40 w-full', className)}
    >
      {data.map((d, i) => {
        const h = (d.value / max) * 52;
        const t = d.target !== undefined ? 56 - (d.target / max) * 52 : null;
        const g = d.extra !== undefined ? (d.extra / max) * 52 : null;
        return (
          <g key={i}>
            <rect
              x={i * w + w * 0.15}
              y={56 - h}
              width={w * 0.7}
              height={Math.max(h, 0.4)}
              rx={0.8}
              className={d.muted ? 'fill-muted-foreground/30' : 'fill-primary'}
            />
            {g !== null && (
              <rect
                x={i * w + w * 0.35}
                y={56 - g}
                width={w * 0.3}
                height={Math.max(g, 0.3)}
                rx={0.5}
                className="fill-status-ok"
              />
            )}
            {t !== null && (
              <line
                x1={i * w + w * 0.08}
                x2={i * w + w * 0.92}
                y1={t}
                y2={t}
                strokeWidth={0.8}
                className="stroke-foreground"
              />
            )}
          </g>
        );
      })}
      <line x1={0} x2={100} y1={56} y2={56} strokeWidth={0.3} className="stroke-border" />
    </svg>
  );
}

export function Spark({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${28 - (v / max) * 26}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden className={cn('h-8 w-full', className)}>
      <polyline
        points={pts}
        fill="none"
        strokeWidth={1.5}
        className="stroke-primary"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Ring({ pct, label, sub }: { pct: number; label: string; sub?: string }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative grid size-32 place-items-center">
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 -rotate-90"
        role="img"
        aria-label={`${label}: ${p}%`}
      >
        <circle cx={50} cy={50} r={r} strokeWidth={10} fill="none" className="stroke-muted" />
        <circle
          cx={50}
          cy={50}
          r={r}
          strokeWidth={10}
          fill="none"
          strokeDasharray={`${(p / 100) * c} ${c}`}
          strokeLinecap="round"
          className="stroke-primary"
        />
      </svg>
      <div className="text-center">
        <div className="text-2xl font-semibold tabular-nums">{p}%</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
