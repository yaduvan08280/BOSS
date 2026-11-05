import { RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';
import { reportError } from '@/lib/report-error';

/** A screen crashed: say so plainly, offer a reload, and report it. */
export function RouteError() {
  const { t } = useTranslation();
  const err = useRouteError();
  useEffect(() => reportError(err), [err]);
  const stale =
    err instanceof Error && /dynamically imported module|Importing a module script failed/.test(err.message);
  return (
    <div className="mx-auto max-w-md space-y-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{stale ? t('errors.newVersion') : t('errors.crashed')}</h1>
      <p className="text-sm text-muted-foreground">
        {stale ? t('errors.newVersionBody') : t('errors.crashedBody')}
      </p>
      <Button onClick={() => window.location.reload()}>
        <RotateCw /> {t('errors.reload')}
      </Button>
    </div>
  );
}
