import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Booking } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { send, useResMutation, type Book } from './api';

const NUMBERS = [
  'slotMin',
  'aheadDays',
  'maxOnline',
  'holdMin',
  'reminderHours',
  'cancelFreeHours',
  'depositFrom',
] as const;

/** An outlet's booking rules: slots, the hold time, the reminder, the deposit, and the public booking page. */
export function RulesDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const { t } = useTranslation();
  const b = book.booking;
  const [n, setN] = useState<Record<(typeof NUMBERS)[number], string>>(
    () =>
      Object.fromEntries(NUMBERS.map((k) => [k, String(b[k])])) as Record<(typeof NUMBERS)[number], string>,
  );
  const [perHead, setPerHead] = useState(String(b.depositPerHeadPaise / 100));
  const [online, setOnline] = useState(b.online);
  const [autoConfirm, setAutoConfirm] = useState(b.autoConfirm);
  const [noShow, setNoShow] = useState<Booking['noShowDeposit']>(b.noShowDeposit);
  const save = useResMutation(
    () =>
      send(
        `/api/reservations/outlets/${book.outlet.id}/rules`,
        {
          ...Object.fromEntries(NUMBERS.map((k) => [k, Number(n[k]) || 0])),
          depositPerHeadPaise: Math.round((Number(perHead) || 0) * 100),
          online,
          autoConfirm,
          noShowDeposit: noShow,
        },
        'PUT',
      ),
    t('res.rules.saved'),
  );
  const link = book.bookingToken ? `${window.location.origin}/book/${book.bookingToken}` : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('res.rules.title', { outlet: book.outlet.name })}
      footer={
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {NUMBERS.map((k) => (
            <Field key={k} label={t(`res.rules.${k}`)}>
              <Input
                inputMode="decimal"
                value={n[k]}
                onChange={(e) => setN((x) => ({ ...x, [k]: e.target.value }))}
              />
            </Field>
          ))}
          <Field label={t('res.rules.depositPerHead')}>
            <Input inputMode="decimal" value={perHead} onChange={(e) => setPerHead(e.target.value)} />
          </Field>
        </div>
        <Field label={t('res.rules.noShowDeposit')}>
          <Select value={noShow} onChange={(e) => setNoShow(e.target.value as Booking['noShowDeposit'])}>
            <option value="KEEP">{t('res.rules.keep')}</option>
            <option value="REFUND">{t('res.rules.refund')}</option>
          </Select>
        </Field>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <span>{t('res.rules.online')}</span>
          <Switch checked={online} onCheckedChange={setOnline} aria-label={t('res.rules.online')} />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <span>{t('res.rules.autoConfirm')}</span>
          <Switch
            checked={autoConfirm}
            onCheckedChange={setAutoConfirm}
            aria-label={t('res.rules.autoConfirm')}
          />
        </label>
        {link && online && (
          <div className="rounded-control bg-muted p-3 text-sm">
            <div className="font-medium">{t('res.rules.link')}</div>
            <a className="break-all text-xs underline" href={link} target="_blank" rel="noreferrer">
              {link}
            </a>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t('res.rules.gateway')}</p>
      </div>
    </Dialog>
  );
}
