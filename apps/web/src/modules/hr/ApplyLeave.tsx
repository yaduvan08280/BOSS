import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, type Me } from '@mono/shared';
import { DictateButton } from '@/components/dictate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, Textarea } from '@/components/ui/form';
import { personLabel } from '@/lib/people';
import { useUsers } from '@/modules/system/api';
import { hrApi, useBalances, useHrMutation, useLeavePreview, useLeaveTypes } from './api';

/** Apply for leave (CLAUDE.md §9.2): the open work in the period and a Buddy for each piece. */
export function ApplyLeave({ me, today, onDone }: { me: Me; today: string; onDone: () => void }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const types = useLeaveTypes();
  const balances = useBalances(today);
  const users = useUsers();
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [half, setHalf] = useState('');
  const [reason, setReason] = useState('');
  const [buddies, setBuddies] = useState<Record<string, string>>({});
  const preview = useLeavePreview(from, to || from, half);
  // Each piece of work starts with the first suggested Buddy; a choice made here wins.
  const buddyOf = (key: string) =>
    buddies[key] ?? preview.data?.items.find((i) => i.key === key)?.suggestions[0]?.id ?? '';
  const send = useHrMutation(
    () =>
      hrApi.applyLeave({
        leaveTypeId: type,
        from,
        to: to || from,
        half: half || null,
        reason,
        buddies: Object.fromEntries(
          (preview.data?.items ?? []).map((i) => [i.key, buddyOf(i.key)]).filter(([, v]) => v),
        ),
      }),
    () => t('hr.l.sent'),
  );
  const balance = (id: string) => balances.data?.balances.find((b) => b.leaveTypeId === id);
  const people = (users.data ?? []).filter((u) => u.status === 'ACTIVE' && u.id !== me.user.id);
  const missing = preview.data?.items.filter((i) => !buddyOf(i.key)).length ?? 0;
  const ready =
    type && from && (to || from) >= from && reason.trim().length >= 3 && (preview.data?.days ?? 0) > 0;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader>
          <CardTitle>{t('hr.l.apply')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t('hr.l.type')} *`} className="sm:col-span-2">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t('org.choose')}</option>
              {(types.data ?? [])
                .filter((x) => x.active)
                .map((x) => {
                  const b = balance(x.id);
                  return (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {b && x.paid ? ` · ${t('hr.l.left', { n: b.available })}` : ''}
                    </option>
                  );
                })}
            </Select>
          </Field>
          <Field label={`${t('hr.l.from')} *`}>
            <DateInput value={from} min={today} onChange={(v) => (setFrom(v), (!to || to < v) && setTo(v))} />
          </Field>
          <Field label={t('hr.l.to')}>
            <DateInput
              value={to}
              min={from || today}
              onChange={(v) => (setTo(v), v !== from && setHalf(''))}
            />
          </Field>
          {from && (to || from) === from && (
            <Field label={t('hr.l.half')} className="sm:col-span-2">
              <Select value={half} onChange={(e) => setHalf(e.target.value)}>
                <option value="">{t('hr.l.fullDay')}</option>
                <option value="FIRST">{t('hr.l.firstHalf')}</option>
                <option value="SECOND">{t('hr.l.secondHalf')}</option>
              </Select>
            </Field>
          )}
          <Field label={`${t('hr.l.reason')} *`} className="sm:col-span-2">
            <Textarea
              rows={2}
              className="font-sans"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <DictateButton onText={(v) => setReason((x) => `${x} ${v}`.trim())} />
            <Button
              variant="primary"
              disabled={!ready || send.isPending}
              onClick={() => send.mutate(undefined, { onSuccess: onDone })}
            >
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t('hr.l.send')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="self-start">
        <CardHeader>
          <CardTitle>{t('hr.l.work')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!from ? (
            <p className="text-muted-foreground">{t('hr.l.pickDates')}</p>
          ) : preview.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : preview.data ? (
            <>
              <p className="font-medium">{t('hr.l.days', { count: preview.data.days })}</p>
              {!preview.data.needsBuddy ? (
                <p className="text-muted-foreground">{t('hr.l.noBuddyNeeded')}</p>
              ) : !preview.data.items.length ? (
                <p className="text-muted-foreground">{t('hr.l.noWork')}</p>
              ) : (
                <ul className="space-y-3">
                  {preview.data.items.map((i) => (
                    <li key={i.key} className="space-y-1.5">
                      <div>
                        <div className="font-medium">{i.title}</div>
                        {i.due && (
                          <div className="text-xs text-muted-foreground">
                            {t('hr.l.due', { at: formatDateTime(i.due, tz) })}
                          </div>
                        )}
                      </div>
                      <Select
                        value={buddyOf(i.key)}
                        aria-label={t('hr.l.buddyFor', { what: i.title })}
                        onChange={(e) => setBuddies({ ...buddies, [i.key]: e.target.value })}
                      >
                        <option value="">{t('hr.l.noBuddy')}</option>
                        {i.suggestions.map((s) => (
                          <option key={`s-${s.id}`} value={s.id}>
                            ★ {[s.name, s.designation].filter(Boolean).join(' · ')}
                          </option>
                        ))}
                        {people
                          .filter((p) => !i.suggestions.some((s) => s.id === p.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {personLabel(p)}
                            </option>
                          ))}
                      </Select>
                    </li>
                  ))}
                </ul>
              )}
              {missing > 0 && (
                <p className={preview.data.rule === 'block' ? 'text-status-bad-fg' : 'text-status-warn-fg'}>
                  {t(preview.data.rule === 'block' ? 'hr.l.blockHint' : 'hr.l.warnHint', { count: missing })}
                </p>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
