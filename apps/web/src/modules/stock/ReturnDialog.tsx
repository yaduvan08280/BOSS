import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { post, qty, useStockMutation, type Grn } from './api';

/**
 * Goods sent back to the vendor against a receipt: how much of each line (never more than was taken in and is
 * not yet returned) and why. The stock leaves the location and the vendor's bill is credited.
 */
export function ReturnDialog({ grn, onClose }: { grn: Grn; onClose: () => void }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const lines = grn.lines
    .map((l) => ({
      ...l,
      left: Math.round((l.received - l.returned) * 1000) / 1000,
      back: Number(typed[l.itemId]) || 0,
    }))
    .filter((l) => l.left > 0);
  const chosen = lines.filter((l) => l.back > 0);
  const over = chosen.some((l) => l.back > l.left);
  const send = useStockMutation(
    () =>
      post(`/api/ims/grn/${grn.id}/return`, {
        lines: chosen.map((l) => ({ itemId: l.itemId, qty: l.back })),
        reason,
      }),
    t('stock.return.done'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.return.title', { number: grn.number })}
      description={grn.vendor ?? undefined}
      footer={
        <Button
          variant="primary"
          disabled={!chosen.length || over || reason.trim().length < 3 || send.isPending}
          onClick={() => send.mutate(undefined, { onSuccess: onClose })}
        >
          {t('stock.return.send')}
        </Button>
      }
    >
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('stock.return.nothing')}</p>
      ) : (
        <div className="space-y-3">
          {lines.map((l) => (
            <div key={l.itemId} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{l.item}</div>
                <div className="text-xs text-muted-foreground">
                  {t('stock.return.canReturn', { qty: qty(l.left), unit: l.stockUnit })}
                </div>
              </div>
              <Input
                aria-label={t('stock.return.qtyOf', { name: l.item })}
                inputMode="decimal"
                placeholder="0"
                aria-invalid={l.back > l.left}
                value={typed[l.itemId] ?? ''}
                onChange={(e) => setTyped({ ...typed, [l.itemId]: e.target.value })}
              />
            </div>
          ))}
          <Field label={t('stock.return.reason')}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
