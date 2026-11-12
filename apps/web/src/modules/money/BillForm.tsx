import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MONEY_BILLS, type BillType } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import {
  money,
  toMinor,
  useModes,
  useMoneyMutation,
  useToday,
  useParties,
  useTaxRates,
  type Bill,
  type Totals,
} from './api';

type Line = { item: string; qty: string; rate: string; taxCode: string };
const blank: Line = { item: '', qty: '1', rate: '', taxCode: '' };

/**
 * Make a paper: one with lines (invoice, purchase bill, credit note, challan) or a money paper (receipt, payment,
 * advance). The totals shown are worked out by the server as the person types, so what is seen is what is saved.
 */
export function BillForm({
  type,
  against,
  partyId: fixedParty,
  onClose,
}: {
  type: BillType;
  /** A credit note: the bill it is for. */
  against?: Bill;
  partyId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isMoney = MONEY_BILLS.includes(type);
  const parties = useParties();
  const rates = useTaxRates();
  const modes = useModes();
  const [partyId, setPartyId] = useState(against?.partyId ?? fixedParty ?? '');
  const [date, setDate] = useState(useToday());
  const [lines, setLines] = useState<Line[]>([blank]);
  const [inclusive, setInclusive] = useState(false);
  const [amount, setAmount] = useState('');
  const [modeId, setModeId] = useState('');
  const [reference, setReference] = useState('');
  const [totals, setTotals] = useState<Totals | null>(null);
  const currency = totals?.currency ?? against?.currency ?? 'INR';
  const codes = [...new Set((rates.data ?? []).map((r) => r.code))];
  const kept = lines.filter((l) => l.item.trim() && Number(l.qty) > 0);
  const body = {
    type,
    partyId,
    date,
    taxInclusive: inclusive,
    againstId: against?.id ?? null,
    lines: isMoney
      ? []
      : kept.map((l) => ({
          item: l.item.trim(),
          qty: Number(l.qty),
          rate: toMinor(l.rate, currency),
          taxCode: l.taxCode || null,
        })),
    ...(isMoney ? { amount: toMinor(amount, currency), modeId: modeId || null } : {}),
    reference: reference || null,
  };
  const key = JSON.stringify(body);
  // The server works the paper out (rates on the day, the party's state, the entity's regime).
  useEffect(() => {
    if (isMoney || !partyId || !kept.length) return;
    let stale = false;
    const timer = setTimeout(() => {
      api<Totals>('/api/money/bills/preview', { method: 'POST', body: JSON.parse(key) })
        .then((r) => !stale && setTotals(r))
        .catch(() => !stale && setTotals(null));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const save = useMoneyMutation(
    (issue: boolean) => api<Bill>('/api/money/bills', { method: 'POST', body: { ...body, issue } }),
    (b) => (b.number ? t('money.saved', { number: b.number }) : t('money.draftSaved')),
  );
  const set = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ready = partyId && (isMoney ? Number(amount) > 0 : kept.length > 0);
  const shown = !isMoney && partyId && kept.length ? totals : null;

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={against ? t('money.creditFor', { number: against.number }) : t(`money.new.${type}`)}
      footer={
        <>
          {!isMoney && (
            <Button
              variant="secondary"
              disabled={!ready || save.isPending}
              onClick={() => save.mutate(false, { onSuccess: onClose })}
            >
              {t('money.saveDraft')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!ready || save.isPending}
            onClick={() => save.mutate(true, { onSuccess: onClose })}
          >
            {isMoney ? t('common.save') : t('money.issue')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('money.party')}>
            <Select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              disabled={Boolean(against || fixedParty)}
            >
              <option value="">{t('org.choose')}</option>
              {(parties.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {`${p.name} · ${p.code}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('money.date')}>
            <DateInput value={date} onChange={setDate} aria-label={t('money.date')} />
          </Field>
        </div>
        {isMoney ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t('money.amount')}>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={t('money.mode')}>
              <Select value={modeId} onChange={(e) => setModeId(e.target.value)}>
                <option value="">{t('money.modeCash')}</option>
                {(modes.data ?? [])
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('money.reference')}>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-3">{t('money.oldestFirst')}</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('money.lines')}</div>
              {lines.map((l, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_auto] gap-2 rounded-control border p-2 sm:grid-cols-[1fr_80px_110px_120px_auto]"
                >
                  <Input
                    aria-label={t('money.item')}
                    placeholder={t('money.item')}
                    value={l.item}
                    onChange={(e) => set(i, { item: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="sm:order-last"
                    aria-label={t('common.remove')}
                    disabled={lines.length === 1}
                    onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                  <div className="col-span-2 grid grid-cols-3 gap-2 sm:contents">
                    <Input
                      aria-label={t('money.qty')}
                      placeholder={t('money.qty')}
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => set(i, { qty: e.target.value })}
                    />
                    <Input
                      aria-label={t('money.rate')}
                      placeholder={t('money.rate')}
                      inputMode="decimal"
                      value={l.rate}
                      onChange={(e) => set(i, { rate: e.target.value })}
                    />
                    <Select
                      aria-label={t('money.tax')}
                      value={l.taxCode}
                      onChange={(e) => set(i, { taxCode: e.target.value })}
                    >
                      <option value="">{t('money.noTax')}</option>
                      {codes.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setLines([...lines, blank])}>
                <Plus /> {t('money.addLine')}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
              {t('money.inclusive')}
            </label>
            <dl className="ml-auto max-w-xs space-y-1 text-sm" aria-live="polite">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('money.taxable')}</dt>
                <dd className="tabular">{shown ? money(shown.taxable, currency) : '—'}</dd>
              </div>
              {(shown?.taxes ?? []).map((x) => (
                <div key={`${x.name}${x.percent}`} className="flex justify-between">
                  <dt className="text-muted-foreground">{`${x.name} ${x.percent}%`}</dt>
                  <dd className="tabular">{money(x.amount, currency)}</dd>
                </div>
              ))}
              {shown && shown.roundOff !== 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('money.roundOff')}</dt>
                  <dd className="tabular">{money(shown.roundOff, currency)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t pt-1 text-base font-semibold">
                <dt>{t('money.total')}</dt>
                <dd className="tabular">{shown ? money(shown.total, currency) : '—'}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </Dialog>
  );
}
