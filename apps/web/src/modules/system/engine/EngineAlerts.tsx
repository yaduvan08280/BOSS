import { BellRing, Workflow } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { NOTIFY_EVENTS, type EngineModule } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { eventLabel, recipientLabel } from '../integration/labels';
import { useRules } from '../integration/api';

/** Each event of an engine module: is a rule on, who gets it, on which channels. */
export function EngineAlerts({ module }: { module: EngineModule }) {
  const { t } = useTranslation();
  const rules = useRules();
  const events = NOTIFY_EVENTS.filter((e) => e.module === module);
  return (
    <div className="space-y-2 p-4">
      <ul className="divide-y rounded-card border">
        {events.map((e) => {
          const rule = rules.data?.find((r) => r.event === e.event && r.active);
          return (
            <li key={e.event} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="flex items-center gap-2">
                <BellRing className="size-4 text-muted-foreground" />
                {eventLabel(t, e.event)}
              </span>
              {rule ? (
                <span className="text-xs text-muted-foreground">
                  {rule.recipients.map((r) => recipientLabel(t, r)).join(', ')} · {rule.channels.join(', ')}
                </span>
              ) : (
                <StatusChip tone="neutral">{t('engine.noRule')}</StatusChip>
              )}
            </li>
          );
        })}
      </ul>
      <Button asChild size="sm" variant="ghost">
        <Link to="/system/integration/rules">
          <Workflow /> {t('engine.editRules')}
        </Link>
      </Button>
    </div>
  );
}
