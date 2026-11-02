import { AlarmClock, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHANNELS, OVERDUE_REPEAT, REMIND_AT, reminderPatternSchema } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { del, patch, post, useOrgMutation } from '../api';
import { useReminders, type ReminderPattern } from './api';

type Draft = Omit<ReminderPattern, 'id'> & { id?: string };
const NEW: Draft = {
  name: '',
  remindAt: ['h1_before', 'at_due'],
  channels: ['telegram', 'inapp'],
  overdueRepeat: 'morning',
  isDefault: false,
};

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function RemindersTab() {
  const { t } = useTranslation();
  const q = useReminders();
  const [d, setD] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useOrgMutation(
    ({ id, ...body }: Draft) =>
      id ? patch(`/api/notify/reminders/${id}`, body) : post('/api/notify/reminders', body),
    { success: t('org.saved') },
  );
  const remove = useOrgMutation((id: string) => del(`/api/notify/reminders/${id}`), {
    success: t('org.deleted'),
  });
  const makeDefault = useOrgMutation((id: string) =>
    patch(`/api/notify/reminders/${id}`, { isDefault: true }),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'h-8 rounded-pill border px-3 text-xs font-medium',
        on
          ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
          : 'bg-card text-muted-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('notify.rem.hint')}</p>
        <Button variant="primary" onClick={() => (setError(null), setD(NEW))}>
          <Plus /> {t('notify.rem.add')}
        </Button>
      </div>
      {q.data.length === 0 ? (
        <EmptyState icon={AlarmClock} title={t('notify.rem.none')} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((p) => (
            <Card key={p.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold">
                  {p.name}
                  {p.isDefault && (
                    <Badge className="bg-accent-soft text-accent-soft-foreground">{t('org.default')}</Badge>
                  )}
                </div>
                <div className="flex">
                  {!p.isDefault && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('notify.rem.setDefault')}
                      onClick={() => makeDefault.mutate(p.id)}
                    >
                      <Star />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('org.edit')}
                    onClick={() => (setError(null), setD(p))}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('org.delete')}
                    onClick={() => remove.mutate(p.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {p.remindAt.map((r) => (
                  <span key={r} className="rounded-pill bg-muted px-2 py-0.5 text-[11px] font-medium">
                    {t(`notify.rem.at.${r}`)}
                  </span>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                {p.channels.map((c) => t(`notify.channel.${c}`)).join(', ')} ·{' '}
                {t(`notify.rem.repeat.${p.overdueRepeat}`)}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={!!d}
        onOpenChange={(o) => !o && setD(null)}
        title={d?.id ? t('notify.rem.edit') : t('notify.rem.add')}
        footer={
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => {
              if (!d) return;
              const parsed = reminderPatternSchema.safeParse(d);
              if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
              save.mutate(d, { onSuccess: () => setD(null) });
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        {d && (
          <div className="space-y-4">
            <Field label={t('org.name')}>
              <Input
                autoFocus
                value={d.name}
                onChange={(e) => setD({ ...d, name: e.target.value })}
                placeholder={t('notify.rem.namePh')}
              />
            </Field>
            <Field label={t('notify.rem.remindAt')}>
              <div className="flex flex-wrap gap-1.5">
                {REMIND_AT.map((r) =>
                  chip(d.remindAt.includes(r), t(`notify.rem.at.${r}`), () =>
                    setD({ ...d, remindAt: toggle(d.remindAt, r) }),
                  ),
                )}
              </div>
            </Field>
            <Field label={t('notify.rule.channels')}>
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.map((c) =>
                  chip(d.channels.includes(c), t(`notify.channel.${c}`), () =>
                    setD({ ...d, channels: toggle(d.channels, c) }),
                  ),
                )}
              </div>
            </Field>
            <Field label={t('notify.rem.overdue')}>
              <div className="flex flex-wrap gap-1.5">
                {OVERDUE_REPEAT.map((r) =>
                  chip(d.overdueRepeat === r, t(`notify.rem.repeat.${r}`), () =>
                    setD({ ...d, overdueRepeat: r }),
                  ),
                )}
              </div>
            </Field>
            {error && <p className="text-sm text-status-bad-fg">{error}</p>}
          </div>
        )}
      </Dialog>
    </div>
  );
}
