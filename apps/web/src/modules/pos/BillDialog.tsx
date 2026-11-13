import { PayLinkButton } from '@/modules/connect/PayLinkButton';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useHosp } from '@/modules/hosp/api';
import { useModes } from '@/modules/money/api';
import { rupees } from '@/modules/stock/api';
import { post, useAdvance, useChecks, usePosMutation, type Check, type Order } from './api';

/** Bill an order (service charge, discount, no-charge, split in equal parts) and take the money, by one mode or several. */
export function BillDialog({
  order,
  outletId,
  onClose,
  onPaid,
}: {
  order: Order;
  outletId: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { t } = useTranslation();
  const checks = useChecks(outletId);
  const hosp = useHosp();
  const modes = useModes();
  const made = (checks.data ?? []).find((c) => c.orderId === order.id && c.status !== 'CANCELLED');
  const [opt, setOpt] = useState({ noService: false, discount: '', reason: '', nc: '', parts: '' });
  const [pays, setPays] = useState([{ modeId: '', amount: '', reference: '' }]);
  const [tip, setTip] = useState('');
  const make = usePosMutation(
    async () => {
      if (Number(opt.parts) > 1)
        await post(`/api/pos/orders/${order.id}/split`, { by: 'EQUAL', parts: Number(opt.parts) });
      return post<Check>(`/api/pos/orders/${order.id}/check`, {
        noServiceCharge: opt.noService,
        ...(opt.nc
          ? { ncReason: opt.nc }
          : Number(opt.discount) > 0
            ? { discount: { kind: 'PERCENT', value: Number(opt.discount), reason: opt.reason || null } }
            : {}),
      });
    },
    (c) => (c.pending ? t('pos.discountAsked') : t('pos.billed', { number: c.number })),
  );
  const pay = usePosMutation(
    () =>
      post<Check>(`/api/pos/checks/${made!.id}/pay`, {
        payments: pays
          .filter((p) => p.modeId && Number(p.amount) > 0)
          .map((p) => ({
            modeId: p.modeId,
            amount: Math.round(Number(p.amount) * 100),
            reference: p.reference || null,
          })),
        ...(Number(tip) > 0 ? { tip: { amount: Math.round(Number(tip) * 100) } } : {}),
      }),
    (c) => (c.status === 'PAID' ? t('pos.paid') : t('pos.partPaid', { due: rupees(c.due) })),
  );
  const advance = useAdvance(order.id);
  const applyDeposit = usePosMutation(
    () => post<Check>(`/api/pos/checks/${made!.id}/advance`),
    t('pos.depositUsed'),
  );
  const reprint = usePosMutation(() => post(`/api/pos/checks/${made!.id}/reprint`), t('pos.reprinted'));
  const set = (i: number, patch: Partial<(typeof pays)[number]>) =>
    setPays(pays.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const list = (modes.data ?? []).filter((m) => m.active && m.kind !== 'COMPLIMENTARY');
  const typed = pays.reduce((n, p) => n + Math.round(Number(p.amount || 0) * 100), 0);
  const row = (label: string, amount: number, strong = false) => (
    <div className={`flex justify-between ${strong ? 'text-base font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular">{rupees(amount)}</dd>
    </div>
  );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={made ? t('pos.billNo', { number: made.number }) : t('pos.bill')}
      footer={
        made ? (
          <>
            <Button variant="ghost" disabled={reprint.isPending} onClick={() => reprint.mutate(undefined)}>
              {t('pos.reprint')}
            </Button>
            {made.status === 'OPEN' && (
              <Button
                variant="primary"
                disabled={typed <= 0 || typed > made.due || pay.isPending}
                onClick={() => pay.mutate(undefined, { onSuccess: (c) => c.status === 'PAID' && onPaid() })}
              >
                {t('pos.takePayment')}
              </Button>
            )}
          </>
        ) : (
          <Button variant="primary" disabled={make.isPending} onClick={() => make.mutate(undefined)}>
            {t('pos.makeBill')}
          </Button>
        )
      }
    >
      {!made ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={opt.noService}
              onChange={(e) => setOpt({ ...opt, noService: e.target.checked })}
            />
            {t('pos.noService')}
          </label>
          <Field label={t('pos.discountPct')} hint={t('pos.discountHint')}>
            <Input
              inputMode="decimal"
              value={opt.discount}
              onChange={(e) => setOpt({ ...opt, discount: e.target.value })}
            />
          </Field>
          <Field label={t('pos.discountWhy')}>
            <Input value={opt.reason} onChange={(e) => setOpt({ ...opt, reason: e.target.value })} />
          </Field>
          <Field label={t('pos.nc')}>
            <Select value={opt.nc} onChange={(e) => setOpt({ ...opt, nc: e.target.value })}>
              <option value="">{t('pos.charged')}</option>
              {(hosp.data?.rules.ncReasons ?? []).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('pos.splitEqual')} hint={t('pos.splitHint')}>
            <Input
              inputMode="numeric"
              value={opt.parts}
              onChange={(e) => setOpt({ ...opt, parts: e.target.value })}
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <dl className="space-y-1 text-sm">
            {row(t('money.taxable'), made.taxable)}
            {made.serviceCharge > 0 && row(t('pos.service'), made.serviceCharge)}
            {made.discount && row(t('pos.discount'), -made.discount.amount)}
            {made.taxes.map((x) => (
              <div key={x.name}>{row(x.name, x.amount)}</div>
            ))}
            {made.roundOff !== 0 && row(t('money.roundOff'), made.roundOff)}
            <div className="border-t pt-1">{row(t('money.total'), made.total, true)}</div>
            {made.payments.map((p, i) => (
              <div key={i}>{row(`${p.mode}${p.reference ? ` · ${p.reference}` : ''}`, -p.amount)}</div>
            ))}
            {made.status === 'OPEN' && row(t('money.stillDue'), made.due, true)}
          </dl>
          {made.parts && (
            <p className="text-sm text-muted-foreground">
              {t('pos.parts', { parts: made.parts.map((p) => rupees(p)).join(' + ') })}
            </p>
          )}
          {made.status === 'OPEN' && advance.data?.advance && (
            <Button
              size="sm"
              disabled={applyDeposit.isPending}
              onClick={() => applyDeposit.mutate(undefined, { onSuccess: () => void advance.refetch() })}
            >
              {t('pos.useDeposit', { amount: rupees(Math.min(advance.data.advance.left, made.due)) })}
            </Button>
          )}
          {made.upi && made.status === 'OPEN' && (
            <a className="block truncate text-sm text-primary underline" href={made.upi}>
              {t('pos.payUpi', { amount: rupees(made.due) })}
            </a>
          )}
          {made.status === 'OPEN' && <PayLinkButton purpose="POS_CHECK" refId={made.id} />}
          {made.status === 'OPEN' && (
            <div className="space-y-2">
              {pays.map((p, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_110px_auto] gap-2 sm:grid-cols-[1fr_110px_1fr_auto]"
                >
                  <Select
                    aria-label={t('money.mode')}
                    value={p.modeId}
                    onChange={(e) =>
                      set(i, { modeId: e.target.value, amount: p.amount || String((made.due - typed) / 100) })
                    }
                  >
                    <option value="">{t('money.mode')}</option>
                    {list.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={t('money.amount')}
                    placeholder={t('money.amount')}
                    inputMode="decimal"
                    value={p.amount}
                    onChange={(e) => set(i, { amount: e.target.value })}
                  />
                  <Input
                    aria-label={t('pos.reference')}
                    placeholder={t('pos.reference')}
                    className="col-span-2 sm:col-span-1"
                    value={p.reference}
                    onChange={(e) => set(i, { reference: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.remove')}
                    className="row-start-1 col-start-3 sm:col-start-4"
                    onClick={() => setPays(pays.length > 1 ? pays.filter((_, j) => j !== i) : pays)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPays([...pays, { modeId: '', amount: '', reference: '' }])}
              >
                <Plus /> {t('pos.anotherMode')}
              </Button>
              <Field label={t('pos.tip')} className="max-w-40">
                <Input inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
