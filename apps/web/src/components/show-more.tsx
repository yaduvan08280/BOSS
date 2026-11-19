import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** "Showing 100 of 480 — Show 100 more", under a list drawn with useShowMore. */
export function ShowMore({
  shown,
  left,
  step,
  onMore,
}: {
  shown: number;
  left: number;
  step: number;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  if (left <= 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 py-3 text-sm text-muted-foreground">
      <span>{t('common.showingOf', { shown, total: shown + left })}</span>
      <Button variant="secondary" size="sm" onClick={onMore}>
        {t('common.showMore', { n: Math.min(step, left) })}
      </Button>
    </div>
  );
}
