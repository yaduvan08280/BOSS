import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { currentViewAs, leaveShadow } from '@/lib/view-as';

/** The bar that says whose eyes the owner is looking through, on every screen. */
export function ShadowBanner() {
  const { t } = useTranslation();
  const v = currentViewAs();
  if (!v) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-status-over-bg px-4 py-2 text-sm text-status-over-fg"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <Eye className="size-4 shrink-0" /> {t('shadow.banner', { name: v.name })}
      </span>
      <button
        onClick={leaveShadow}
        className="min-h-9 rounded-pill border border-current px-3 text-xs font-semibold"
      >
        {t('shadow.leave')}
      </button>
    </div>
  );
}
