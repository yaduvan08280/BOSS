import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ADJUST_REASONS, type MoveType } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Chips } from '@/modules/hr/ui';
import { imsApi, qty as showQty, useImsMutation, type ItemRow } from './api';

/** Stock in / out / transfer / adjustment for one item (or pick it). Adjustments go for approval. */
export function MoveDialog({
  items,
  itemId,
  open,
  onClose,
  canAdjust = true,
}: {
  items: ItemRow[];
  itemId?: string;
  open: boolean;
  onClose: () => void;
  canAdjust?: boolean;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState(itemId ?? '');
  const [type, setType] = useState<MoveType>('OUT');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState<(typeof ADJUST_REASONS)[number]>('DAMAGED');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const item = items.find((i) => i.id === id);
  const n = Number(amount.replace(/,/g, ''));
  const ok = item && n > 0 && Number.isFinite(n) && (type !== 'TRANSFER' || to.trim());
  // Found adds stock; damaged, expired and lost take it away; a count can go either way (sign typed).
  const signed = type === 'ADJUST' ? (reason === 'FOUND' ? n : -n) : n;
  const short = item && (type === 'OUT' || (type === 'ADJUST' && signed < 0)) && n > item.stock;
  const save = useImsMutation(
    () =>
      imsApi.move({
        itemId: id,
        type,
        qty: signed,
        ratePaise: type === 'IN' && rate ? Math.round(Number(rate) * 100) : undefined,
        reason: type === 'ADJUST' ? reason : undefined,
        toLocation: type === 'TRANSFER' ? to.trim() : undefined,
        note: note.trim() || undefined,
      }),
    (r) =>
      r.pending
        ? t('ims.m.sentForApproval')
        : t('ims.m.saved', { stock: showQty(r.stock ?? 0), unit: item?.unit ?? '' }),
  );
  const types: MoveType[] = canAdjust ? ['OUT', 'IN', 'TRANSFER', 'ADJUST'] : ['OUT', 'IN', 'TRANSFER'];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('ims.m.title')}
      description={
        item
          ? t('ims.m.inStock', { stock: showQty(item.stock), unit: item.unit, name: item.name })
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!ok || Boolean(short) || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {save.isPending && <Loader2 className="animate-spin" />}{' '}
            {type === 'ADJUST' ? t('ims.m.askApproval') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!itemId && (
          <Field label={t('ims.m.item')}>
            <Select value={id} onChange={(e) => setId(e.target.value)} aria-label={t('ims.m.item')}>
              <option value="">{t('org.choose')}</option>
              {items
                .filter((i) => i.active)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {`${i.code} · ${i.name}`}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Chips
          label={t('ims.m.kind')}
          value={type}
          onChange={setType}
          options={types.map((k) => ({ value: k, label: t(`ims.type.${k}`) }))}
        />
        {type === 'ADJUST' && (
          <Chips
            label={t('ims.m.reason')}
            value={reason}
            onChange={setReason}
            options={ADJUST_REASONS.filter((r) => r !== 'COUNT').map((r) => ({
              value: r,
              label: t(`ims.reason.${r}`),
            }))}
          />
        )}
        <Field
          label={t('ims.m.qty', { unit: item?.unit ?? '' })}
          error={short ? t('ims.m.short', { stock: showQty(item!.stock), unit: item!.unit }) : undefined}
        >
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-40 tabular-nums"
          />
        </Field>
        {type === 'IN' && (
          <Field label={t('ims.m.rate')} hint={t('ims.m.rateHint')}>
            <Input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-40 tabular-nums"
            />
          </Field>
        )}
        {type === 'TRANSFER' && (
          <Field
            label={t('ims.m.to')}
            hint={item?.location ? t('ims.m.from', { where: item.location }) : undefined}
          >
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('ims.m.toPh')} />
          </Field>
        )}
        <Field label={t('ims.m.note')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
