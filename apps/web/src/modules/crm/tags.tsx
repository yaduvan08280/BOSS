import { useTranslation } from 'react-i18next';
import type { AutoTag, CrmConfig, StatusTone } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';

const AUTO_TONE: Record<AutoTag, StatusTone> = {
  top20: 'ok',
  middle: 'neutral',
  bottom20: 'warn',
  new: 'info',
  sleeping: 'warn',
  lost: 'bad',
  vampire: 'over',
  owners: 'info',
};

/** A customer's tags: the automatic ones (fixed status colours) and your own (their colour as a dot). */
export function TagChips({ auto, own, defs }: { auto: AutoTag[]; own: string[]; defs: CrmConfig['tags'] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-start gap-1">
      {auto
        .filter((x) => x !== 'middle')
        .map((x) => (
          <StatusChip key={x} tone={AUTO_TONE[x]}>
            {t(`crm.tag.${x}`)}
          </StatusChip>
        ))}
      {own.map((k) => {
        const d = defs.find((x) => x.key === k);
        return (
          <span key={k} className="inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs">
            <span
              className="size-2 rounded-full"
              style={{ background: d?.color ?? 'currentColor' }}
              aria-hidden
            />
            {d?.name ?? k}
          </span>
        );
      })}
    </div>
  );
}
