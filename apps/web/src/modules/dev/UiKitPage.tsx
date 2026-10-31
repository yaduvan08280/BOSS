import { CheckCircle2, ClipboardList, Inbox, Plus, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatINR, rupeesToPaise, STATUS_TONES, type Me } from '@mono/shared';
import { EmptyState, KpiTile, PageHeader } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ThemePlayground } from './ThemePlayground';

const SWATCHES = [
  'background',
  'card',
  'muted',
  'border',
  'foreground',
  'muted-foreground',
  'ink',
  'accent',
  'accent-soft',
  'primary',
  'sidebar',
  'sidebar-active',
  'ring',
  'destructive',
];

const ROWS = [
  { no: '#70', task: 'Calibrate press 2 gauges', who: 'Sandeep', tone: 'bad' as const },
  { no: '#71', task: 'Resin stock count, Niwai', who: 'Ajay', tone: 'warn' as const },
  { no: '#72', task: 'Send Levanto price list', who: 'Priya', tone: 'ok' as const },
];

export function UiKitPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dev.title')}
        subtitle={t('dev.subtitle')}
        actions={
          <Button variant="primary">
            <Plus /> Add task
          </Button>
        }
      />
      <ThemePlayground me={me} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile hero label="Pending" value={18} note="your open tasks" icon={ClipboardList} />
        <KpiTile label="Overdue" value={4} tone="bad" note="past planned date" icon={Timer} />
        <KpiTile
          label="Revenue MTD"
          value={formatINR(rupeesToPaise(4536000), { compact: true })}
          note="57% of target"
        />
        <KpiTile label="My score" value={86} unit="%" note="work done this week" icon={CheckCircle2} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status chips</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {STATUS_TONES.map((tone) => (
            <StatusChip key={tone} tone={tone}>
              {t(`status.${tone}`)}
            </StatusChip>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>List rows (cards on phones, rows on desktop)</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0 sm:p-0">
          {ROWS.map((r) => (
            <div key={r.no} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <span className="font-mono text-xs text-muted-foreground">{r.no}</span>{' '}
                <span className="text-sm font-medium">{r.task}</span>
                <div className="text-xs text-muted-foreground">{r.who} · by Nikhil</div>
              </div>
              <StatusChip tone={r.tone}>{t(`status.${r.tone}`)}</StatusChip>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Buttons and fields</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary">Primary</Button>
              <Button>Secondary</Button>
              <Button variant="ink">Ink</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Delete</Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kit-input">Task description</Label>
              <Input id="kit-input" placeholder="Calibrate press 2 gauges" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kit-bad">With an error</Label>
              <Input id="kit-bad" aria-invalid defaultValue="12/13/2026" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Colour tokens</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SWATCHES.map((s) => (
              <div key={s} className="flex items-center gap-2 text-xs">
                <span
                  className="size-7 shrink-0 rounded-control border"
                  style={{ background: `var(--${s})` }}
                />
                <span className="truncate font-mono">{s}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EmptyState
          icon={Inbox}
          title="Nothing waiting on you"
          body="New tasks show up here the moment they're assigned."
        />
        <Card className="space-y-3 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-24 w-full rounded-card" />
        </Card>
      </div>
      <p className="font-mono text-sm text-muted-foreground">BOP/26-27/0004 · EMP-001 · ₹1,23,456.78</p>
    </div>
  );
}
