import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NOTIFY_EVENTS, renderText, templateVariables } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { patch, post, useOrgMutation } from '../api';
import type { Template } from './api';
import { eventLabel } from './labels';

const SAMPLE: Record<string, string> = {
  app: 'MONO',
  company: 'GGM Minerals',
  recipient: 'Sandeep Pal',
  actor: 'Nikhil',
  doer: 'Sandeep Pal',
  creator: 'Nikhil',
  verifier: 'Ajay',
  number: '70',
  title: 'Calibrate press 2 gauges',
  due: '05/11/2026 18:00',
  link: 'https://mono.ggminerals.com/delegation',
  customer: 'Ram Traders',
  amount: '₹45,000',
  checklist: 'Morning safety round',
  code: 'K7M2Q9XA',
  bot: '@ggm_mono_bot',
};

type Draft = {
  code: string;
  channel: Template['channel'];
  event: string | null;
  category: string;
  language: string;
  subject: string;
  body: string;
};

/** New or edit: the text with {{variables}}, inserted by tapping a chip, and a live preview. */
export function TemplateDialog({ template, onClose }: { template: Template | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const editing = template !== 'new';
  const [d, setD] = useState<Draft>(() =>
    editing
      ? {
          code: template.code,
          channel: template.channel,
          event: template.event,
          category: template.category,
          language: template.language,
          subject: template.subject ?? '',
          body: template.body,
        }
      : {
          code: '',
          channel: 'telegram',
          event: null,
          category: 'UTILITY',
          language: 'en',
          subject: '',
          body: '',
        },
  );
  const save = useOrgMutation(
    () => {
      const body = { ...d, subject: d.channel === 'email' ? d.subject : null };
      return editing
        ? patch(`/api/notify/templates/${template.id}`, body)
        : post('/api/notify/templates', body);
    },
    { success: t('org.saved') },
  );
  const suggested = useMemo(() => {
    const e = NOTIFY_EVENTS.find((x) => x.event === d.event);
    return [
      ...new Set([...(e ? templateVariables(e.title.en + e.body.en) : []), 'recipient', 'app', 'link']),
    ];
  }, [d.event]);
  const insert = (v: string) => setD((x) => ({ ...x, body: `${x.body}{{${v}}}` }));
  const preview = renderText(d.body, SAMPLE).replace(/<\/?b>/g, '');

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={editing ? template.code : t('notify.tpl.new')}
      wide
      footer={
        <Button
          variant="primary"
          disabled={!d.code || !d.body.trim() || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('notify.tpl.code')} className="col-span-2 sm:col-span-1">
              <Input
                value={d.code}
                disabled={editing}
                className="font-mono"
                onChange={(e) =>
                  setD({ ...d, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })
                }
                placeholder="att_flag_wa"
              />
            </Field>
            <Field label={t('notify.tpl.event')} className="col-span-2 sm:col-span-1">
              <Select value={d.event ?? ''} onChange={(e) => setD({ ...d, event: e.target.value || null })}>
                <option value="">—</option>
                {NOTIFY_EVENTS.map((e) => (
                  <option key={e.event} value={e.event}>
                    {eventLabel(t, e.event)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('notify.tpl.channel')}>
              <Select
                value={d.channel}
                disabled={editing}
                onChange={(e) => setD({ ...d, channel: e.target.value as Draft['channel'] })}
              >
                {(['telegram', 'whatsapp', 'email'] as const).map((c) => (
                  <option key={c} value={c}>
                    {t(`notify.channel.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('notify.tpl.language')}>
              <Select
                value={d.language}
                disabled={editing}
                onChange={(e) => setD({ ...d, language: e.target.value })}
              >
                <option value="en">English</option>
                <option value="hi">हिंदी</option>
              </Select>
            </Field>
            {d.channel === 'whatsapp' && (
              <Field label={t('notify.tpl.category')} className="col-span-2">
                <Select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
                  {['UTILITY', 'MARKETING', 'AUTHENTICATION'].map((c) => (
                    <option key={c} value={c}>
                      {t(`notify.tpl.cat.${c}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {d.channel === 'email' && (
              <Field label={t('notify.tpl.subject')} className="col-span-2">
                <Input value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} />
              </Field>
            )}
          </div>
          <Field
            label={t('notify.tpl.body')}
            hint={
              d.channel === 'telegram'
                ? t('notify.tpl.tgHint')
                : d.channel === 'whatsapp'
                  ? t('notify.tpl.waHint')
                  : undefined
            }
          >
            <Textarea rows={6} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {suggested.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insert(v)}
                className="h-7 rounded-pill bg-muted px-2.5 font-mono text-xs hover:bg-accent-soft"
              >{`{{${v}}}`}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium">{t('notify.tpl.preview')}</div>
          <div className="whitespace-pre-wrap rounded-card border bg-[#E7F7E0] p-3 text-sm text-[#1C1B19] shadow-inner dark:bg-[#1F3A2A] dark:text-[#E9F5E3]">
            {d.channel === 'email' && (
              <div className="mb-2 font-semibold">{renderText(d.subject, SAMPLE)}</div>
            )}
            {preview || '…'}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
