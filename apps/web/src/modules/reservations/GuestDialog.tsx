import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Switch, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { rupees } from '@/modules/stock/api';
import { send, useGuest, useResMutation, type GuestProfile } from './api';

type Draft = {
  name: string;
  mobile: string;
  email: string;
  birthday: string;
  anniversary: string;
  allergies: string;
  preferences: string;
  notes: string;
  tags: string;
};
const draftOf = (g?: GuestProfile): Draft => ({
  name: g?.name ?? '',
  mobile: g?.mobile ?? '',
  email: g?.email ?? '',
  birthday: g?.birthday ?? '',
  anniversary: g?.anniversary ?? '',
  allergies: g?.allergies ?? '',
  preferences: g?.preferences ?? '',
  notes: g?.notes ?? '',
  tags: (g?.tags ?? []).join(', '),
});

/** A guest's profile: what they told us (editable), their consent, and their history read from orders and bookings. */
export function GuestDialog({
  id,
  canHost,
  onClose,
}: {
  id: string | null;
  canHost: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const guest = useGuest(id);
  if (id && !guest.data)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title={t('guest.title')}>
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </Dialog>
    );
  return <GuestForm key={id ?? 'new'} guest={guest.data} canHost={canHost} onClose={onClose} />;
}

function GuestForm({
  guest,
  canHost,
  onClose,
}: {
  guest: GuestProfile | undefined;
  canHost: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState<Draft>(() => draftOf(guest));
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setD((x) => ({ ...x, [k]: e.target.value }));
  const save = useResMutation(() => {
    const body = {
      name: d.name,
      mobile: d.mobile,
      email: d.email || null,
      birthday: d.birthday || null,
      anniversary: d.anniversary || null,
      allergies: d.allergies || null,
      preferences: d.preferences || null,
      notes: d.notes || null,
      tags: d.tags
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    };
    return guest ? send(`/api/guests/${guest.id}`, body, 'PATCH') : send('/api/guests', body);
  }, t('guest.saved'));
  const consent = useResMutation(
    (marketing: boolean) => send(`/api/guests/${guest!.id}/consent`, { marketing, source: 'STAFF' }),
    t('guest.consentSaved'),
  );
  const h = guest?.history;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={guest ? guest.name : t('guest.add')}
      footer={
        canHost && (
          <Button
            variant="primary"
            disabled={!d.name.trim() || d.mobile.trim().length < 8 || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {t('common.save')}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {h && (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[
              [t('guest.h.visits'), String(h.visits)],
              [t('guest.h.spend'), rupees(h.spend)],
              [t('guest.h.average'), rupees(h.average)],
              [t('guest.h.noShows'), String(h.noShows)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-control bg-muted p-2">
                <div className="text-xs text-muted-foreground">{k}</div>
                <div className="tabular font-semibold">{v}</div>
              </div>
            ))}
          </div>
        )}
        {h && h.favourites.length > 0 && (
          <p className="text-sm">
            <span className="font-medium">{t('guest.h.favourites')}: </span>
            {h.favourites.map((f) => `${f.name} × ${f.qty}`).join(' · ')}
          </p>
        )}
        {guest && guest.upcoming.length > 0 && (
          <p className="text-sm">
            <span className="font-medium">{t('guest.h.upcoming')}: </span>
            {guest.upcoming.map((u) => `${u.when} · ${u.outlet} · ${u.size}`).join('; ')}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('res.name')}>
            <Input value={d.name} onChange={set('name')} />
          </Field>
          <Field label={t('res.mobile')}>
            <Input inputMode="tel" value={d.mobile} onChange={set('mobile')} />
          </Field>
          <Field label={t('guest.email')}>
            <Input value={d.email} onChange={set('email')} />
          </Field>
          <Field label={t('guest.tags')} hint={t('guest.tagsHint')}>
            <Input value={d.tags} onChange={set('tags')} />
          </Field>
          <Field label={t('guest.birthday')}>
            <DateInput
              value={d.birthday}
              onChange={(v) => setD((x) => ({ ...x, birthday: v }))}
              aria-label={t('guest.birthday')}
            />
          </Field>
          <Field label={t('guest.anniversary')}>
            <DateInput
              value={d.anniversary}
              onChange={(v) => setD((x) => ({ ...x, anniversary: v }))}
              aria-label={t('guest.anniversary')}
            />
          </Field>
        </div>
        <Field label={t('guest.allergies')}>
          <Input value={d.allergies} onChange={set('allergies')} />
        </Field>
        <Field label={t('guest.preferences')}>
          <Input value={d.preferences} onChange={set('preferences')} />
        </Field>
        <Field label={t('guest.notes')}>
          <Textarea rows={2} value={d.notes} onChange={set('notes')} />
        </Field>
        {guest && (
          <div className="space-y-1 rounded-control border p-3">
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              <span className="font-medium">{t('guest.consent')}</span>
              <Switch
                checked={guest.consent?.marketing === true}
                disabled={!canHost || consent.isPending}
                onCheckedChange={(v) => consent.mutate(v)}
                aria-label={t('guest.consent')}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {guest.consent
                ? t(guest.consent.marketing ? 'guest.consentGiven' : 'guest.consentTaken', {
                    when: formatDate(guest.consent.at),
                    how: t(`guest.source.${guest.consent.source}`),
                  })
                : t('guest.consentNever')}
            </p>
            {guest.consentLog.length > 1 && (
              <p className="text-xs text-muted-foreground">
                {t('guest.consentLog', { count: guest.consentLog.length })}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
