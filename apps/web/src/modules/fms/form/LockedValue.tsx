import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FlowField } from '@mono/shared';
import { useMe } from '@/modules/auth/session';
import { showValue } from '../show';

/** A field another field fills and nobody types in (`locked`): its value, read-only. The server works it out again on save. */
export function LockedValue({ field, value }: { field: FlowField; value: unknown }) {
  const { t } = useTranslation();
  const tz = useMe().data?.company.timezone ?? 'Asia/Kolkata';
  const shown = showValue(field, value, tz, [t('fms.yes'), t('fms.no')]);
  return (
    <div
      role="textbox"
      aria-readonly="true"
      aria-label={field.label}
      title={t('links.lockedHint')}
      className="flex min-h-11 w-full items-center gap-2 rounded-control border border-dashed bg-muted/50 px-3 text-base sm:min-h-10 sm:text-sm"
    >
      <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className={shown ? 'break-words' : 'text-muted-foreground'}>
        {shown ?? t('links.lockedEmpty')}
      </span>
    </div>
  );
}
