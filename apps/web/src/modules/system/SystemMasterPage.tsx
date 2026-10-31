import { Activity, Blocks, Building2, Users, Workflow, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page';
import { Card } from '@/components/ui/card';
import { SYSTEM_NAV } from '@/layout/nav';

const CARDS: { key: string; icon: LucideIcon; phase: number }[] = [
  { key: 'cardCompany', icon: Building2, phase: 1 },
  { key: 'cardEngine', icon: Blocks, phase: 4 },
  { key: 'cardProcesses', icon: Workflow, phase: 5 },
  { key: 'cardPeople', icon: Users, phase: 1 },
  { key: 'cardHealth', icon: Activity, phase: 1 },
];

export function SystemMasterPage() {
  const { t } = useTranslation();
  const tabs = SYSTEM_NAV.flatMap((s) => s.items);
  return (
    <>
      <PageHeader title={t('system.title')} subtitle={t('system.subtitle')} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {CARDS.map((c, i) => (
          <Card
            key={c.key}
            className={
              i === 0
                ? 'col-span-2 border-ink bg-ink p-4 text-ink-foreground md:col-span-1 sm:p-5'
                : 'p-4 sm:p-5'
            }
          >
            <c.icon className={i === 0 ? 'size-5 opacity-80' : 'size-5 text-muted-foreground'} />
            <div className="mt-3 text-[15px] font-semibold">{t(`system.${c.key}`)}</div>
            <div className={i === 0 ? 'mt-0.5 text-xs opacity-70' : 'mt-0.5 text-xs text-muted-foreground'}>
              {t('system.cardSoon', { phase: c.phase })}
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            to={tab.path}
            className="flex items-center gap-3 rounded-card border bg-card p-3.5 hover:bg-muted/50"
          >
            <span className="grid size-10 place-items-center rounded-control bg-muted">
              <tab.icon className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t(`nav.${tab.key}`)}</span>
              <span className="block truncate text-xs text-muted-foreground">{t(`navDesc.${tab.key}`)}</span>
            </span>
            {tab.phase > 0 && (
              <span className="tabular rounded-pill bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                P{tab.phase}
              </span>
            )}
          </Link>
        ))}
      </div>
    </>
  );
}
