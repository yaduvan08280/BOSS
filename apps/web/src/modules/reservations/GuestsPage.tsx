import { Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useGuests } from './api';
import { GuestDialog } from './GuestDialog';

/** Guests (phase 16): one profile per mobile — what they told us and what they did. */
export function GuestsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [marketing, setMarketing] = useState('');
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const query = new URLSearchParams(
    Object.entries({ q, tag, marketing }).filter(([, v]) => v) as [string, string][],
  ).toString();
  const guests = useGuests(query ? `?${query}` : '');
  const canHost = hasPermission(me.user.permissions, 'hosp.create');
  return (
    <div>
      <PageHeader
        title={t('guest.title')}
        subtitle={t('guest.subtitle')}
        actions={
          canHost && (
            <Button size="sm" variant="primary" onClick={() => setOpen('new')}>
              <Plus /> {t('guest.add')}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="w-full sm:w-64"
          placeholder={t('guest.search')}
          aria-label={t('guest.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="w-full sm:w-52">
          <Select
            aria-label={t('guest.offers')}
            value={marketing}
            onChange={(e) => setMarketing(e.target.value)}
          >
            <option value="">{t('guest.everyone')}</option>
            <option value="yes">{t('guest.consentYes')}</option>
            <option value="no">{t('guest.consentNo')}</option>
          </Select>
        </div>
        {(guests.data?.tags ?? []).map((x) => (
          <button
            key={x}
            type="button"
            aria-pressed={tag === x}
            onClick={() => setTag(tag === x ? '' : x)}
            className={cn(
              'h-8 rounded-pill border px-3 text-xs font-medium',
              tag === x ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
            )}
          >
            {x}
          </button>
        ))}
      </div>
      {guests.isPending ? (
        <PageSkeleton />
      ) : guests.isError ? (
        <ErrorState onRetry={() => void guests.refetch()} error={guests.error} />
      ) : guests.data.guests.length === 0 ? (
        <EmptyState icon={Users} title={t('guest.empty')} body={t('guest.emptyBody')} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {guests.data.guests.map((g) => (
            <li key={g.id}>
              <button type="button" className="w-full text-left" onClick={() => setOpen(g.id)}>
                <Card className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{g.name}</span>
                    <span className="flex flex-wrap gap-1">
                      {g.tags.map((x) => (
                        <StatusChip key={x} tone="info">
                          {x}
                        </StatusChip>
                      ))}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {g.mobile} · {t('guest.visits', { count: g.visits })}
                    {g.lastVisit ? ` · ${formatDate(g.lastVisit)}` : ''}
                  </div>
                  {g.allergies && (
                    <div className="text-xs text-status-bad-fg">
                      {t('res.allergies', { what: g.allergies })}
                    </div>
                  )}
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <GuestDialog id={open === 'new' ? null : open} canHost={canHost} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
