import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHANNELS, NOTIFY_EVENTS, RECIPIENTS, ruleSchema } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { patch, post, useOrgMutation } from '../api';
import type { Rule } from './api';
import { eventLabel } from './labels';

type Draft = {
  event: string;
  audience: Rule['audience'];
  recipients: string[];
  channels: string[];
  waitMinutes: string;
  escalateTo: string;
  escalateAfterMinutes: string;
};

function Chips({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
  label: (o: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn(
              'h-8 rounded-pill border px-3 text-xs font-medium',
              on
                ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                : 'bg-card text-muted-foreground',
            )}
          >
            {label(o)}
          </button>
        );
      })}
    </div>
  );
}

export function RuleDialog({ rule, onClose }: { rule: Rule | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const editing = rule !== 'new';
  const [d, setD] = useState<Draft>(() =>
    editing
      ? {
          event: rule.event,
          audience: rule.audience,
          recipients: rule.recipients,
          channels: rule.channels,
          waitMinutes: String(rule.waitMinutes),
          escalateTo: rule.escalateTo ?? '',
          escalateAfterMinutes: rule.escalateAfterMinutes ? String(rule.escalateAfterMinutes) : '',
        }
      : {
          event: 'delegation.assigned',
          audience: 'team',
          recipients: ['doer'],
          channels: ['telegram', 'inapp'],
          waitMinutes: '0',
          escalateTo: '',
          escalateAfterMinutes: '',
        },
  );
  const [error, setError] = useState<string | null>(null);
  const save = useOrgMutation(
    (body: unknown) =>
      editing ? patch(`/api/notify/rules/${rule.id}`, body) : post('/api/notify/rules', body),
    { success: t('org.saved') },
  );

  const submit = () => {
    const body = {
      event: d.event,
      audience: d.audience,
      recipients: d.recipients,
      channels: d.channels,
      waitMinutes: Number(d.waitMinutes || 0),
      escalateTo: d.escalateTo || null,
      escalateAfterMinutes: d.escalateAfterMinutes ? Number(d.escalateAfterMinutes) : null,
    };
    const parsed = ruleSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
    if (Boolean(body.escalateTo) !== Boolean(body.escalateAfterMinutes))
      return setError(t('notify.rule.escalateBoth'));
    save.mutate(parsed.data, { onSuccess: onClose });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={editing ? t('notify.rule.edit') : t('notify.rule.add')}
      wide
      footer={
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('notify.rule.when')}>
            <Select value={d.event} onChange={(e) => setD({ ...d, event: e.target.value })}>
              {NOTIFY_EVENTS.map((e) => (
                <option key={e.event} value={e.event}>
                  {eventLabel(t, e.event)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('notify.rule.for')}>
            <Select
              value={d.audience}
              onChange={(e) => setD({ ...d, audience: e.target.value as Draft['audience'] })}
            >
              {(['team', 'client', 'vendor'] as const).map((a) => (
                <option key={a} value={a}>
                  {t(`notify.aud.${a}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('notify.rule.sendTo')}>
          <Chips
            options={RECIPIENTS}
            value={d.recipients}
            onChange={(recipients) => setD({ ...d, recipients })}
            label={(o) => t(`notify.to.${o}`)}
          />
        </Field>
        <Field label={t('notify.rule.channels')}>
          <Chips
            options={CHANNELS}
            value={d.channels}
            onChange={(channels) => setD({ ...d, channels })}
            label={(o) => t(`notify.channel.${o}`)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('notify.rule.wait')} hint={t('notify.rule.minutes')}>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={d.waitMinutes}
              onChange={(e) => setD({ ...d, waitMinutes: e.target.value })}
            />
          </Field>
          <Field label={t('notify.rule.escalateTo')}>
            <Select value={d.escalateTo} onChange={(e) => setD({ ...d, escalateTo: e.target.value })}>
              <option value="">{t('notify.rule.noEscalation')}</option>
              {['hod', 'owner', 'coordinator', 'creator', 'verifier'].map((r) => (
                <option key={r} value={r}>
                  {t(`notify.to.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('notify.rule.after')} hint={t('notify.rule.minutes')}>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              disabled={!d.escalateTo}
              value={d.escalateAfterMinutes}
              onChange={(e) => setD({ ...d, escalateAfterMinutes: e.target.value })}
              placeholder="10"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t('notify.rule.replyMeans')}</p>
        {error && <p className="text-sm text-status-bad-fg">{error}</p>}
      </div>
    </Dialog>
  );
}
