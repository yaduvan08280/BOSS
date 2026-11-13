import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HospRules } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TimeInput } from '@/components/ui/date-input';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useModes, useMoneyMutation } from '@/modules/money/api';
import { useRoles } from '@/modules/system/api';
import { api } from '@/lib/api';
import { hhmm, send, toMin, useHospMutation } from './api';

const MODE_KINDS = ['CASH', 'UPI', 'CARD', 'WALLET', 'ROOM', 'COMPANY', 'COMPLIMENTARY'] as const;

/** Discounts and their limits per role, no-charge reasons, the day-close rules, and how money is taken. */
export function RulesPanel({ rules }: { rules: HospRules }) {
  const { t } = useTranslation();
  const roles = useRoles();
  const [d, setD] = useState(rules);
  const [nc, setNc] = useState('');
  const save = useHospMutation(() => send('PUT', '/api/hosp/settings', { rules: d }), t('org.saved'));
  const limitOf = (roleId: string) => d.limits.find((l) => l.roleId === roleId);
  const setLimit = (roleId: string, patch: Partial<HospRules['limits'][number]>) =>
    setD({
      ...d,
      limits: [
        ...d.limits.filter((l) => l.roleId !== roleId),
        { roleId, maxPct: 0, maxPaise: 0, nc: false, ...limitOf(roleId), ...patch },
      ],
    });
  const setDiscount = (i: number, patch: Partial<HospRules['discounts'][number]>) =>
    setD({ ...d, discounts: d.discounts.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('hosp.rules.discounts')}</h3>
        {d.discounts.map((x, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_130px_130px_110px_auto]">
            <Input
              aria-label={t('hosp.rules.discountName')}
              placeholder={t('hosp.rules.discountName')}
              value={x.name}
              onChange={(e) =>
                setDiscount(i, {
                  name: e.target.value,
                  key:
                    x.key ||
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '_')
                      .replace(/^_|_$/g, '') ||
                    'd',
                })
              }
            />
            <Select
              aria-label={t('hosp.rules.kind')}
              value={x.kind}
              onChange={(e) => setDiscount(i, { kind: e.target.value as 'PERCENT' })}
            >
              <option value="PERCENT">{t('hosp.rules.PERCENT')}</option>
              <option value="AMOUNT">{t('hosp.rules.AMOUNT')}</option>
            </Select>
            <Select
              aria-label={t('hosp.rules.on')}
              value={x.on}
              onChange={(e) => setDiscount(i, { on: e.target.value as 'BILL' })}
            >
              <option value="BILL">{t('hosp.rules.BILL')}</option>
              <option value="ITEM">{t('hosp.rules.ITEM')}</option>
            </Select>
            <Input
              aria-label={t('hosp.rules.value')}
              placeholder={t('hosp.rules.value')}
              inputMode="decimal"
              value={x.value ?? ''}
              onChange={(e) =>
                setDiscount(i, { value: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.remove')}
              onClick={() => setD({ ...d, discounts: d.discounts.filter((_, j) => j !== i) })}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setD({
              ...d,
              discounts: [...d.discounts, { key: '', name: '', kind: 'PERCENT', on: 'BILL', value: null }],
            })
          }
        >
          <Plus /> {t('hosp.rules.addDiscount')}
        </Button>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('hosp.rules.limits')}</h3>
        <p className="text-sm text-muted-foreground">{t('hosp.rules.limitsHint')}</p>
        <ul className="space-y-2">
          {(roles.data?.roles ?? []).map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_120px_140px_auto]"
            >
              <span className="text-sm font-medium">{r.name}</span>
              <Input
                aria-label={t('hosp.rules.maxPctOf', { role: r.name })}
                placeholder={t('hosp.rules.maxPct')}
                inputMode="decimal"
                value={limitOf(r.id)?.maxPct ?? ''}
                onChange={(e) => setLimit(r.id, { maxPct: Number(e.target.value) || 0 })}
              />
              <Input
                aria-label={t('hosp.rules.maxAmountOf', { role: r.name })}
                placeholder={t('hosp.rules.maxAmount')}
                inputMode="decimal"
                value={limitOf(r.id)?.maxPaise ? limitOf(r.id)!.maxPaise / 100 : ''}
                onChange={(e) => setLimit(r.id, { maxPaise: Math.round(Number(e.target.value || 0) * 100) })}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={limitOf(r.id)?.nc ?? false}
                  onChange={(e) => setLimit(r.id, { nc: e.target.checked })}
                />
                {t('hosp.rules.nc')}
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('hosp.rules.ncReasons')}</h3>
        <div className="flex flex-wrap gap-1.5">
          {d.ncReasons.map((r) => (
            <button
              key={r}
              type="button"
              className="rounded-pill border px-3 py-1 text-sm"
              onClick={() => setD({ ...d, ncReasons: d.ncReasons.filter((x) => x !== r) })}
              title={t('common.remove')}
            >
              {r} ×
            </button>
          ))}
        </div>
        <div className="flex max-w-md gap-2">
          <Input
            aria-label={t('hosp.rules.ncReason')}
            placeholder={t('hosp.rules.ncReason')}
            value={nc}
            onChange={(e) => setNc(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!nc.trim()}
            onClick={() => {
              setD({ ...d, ncReasons: [...d.ncReasons, nc.trim()] });
              setNc('');
            }}
          >
            <Plus /> {t('hosp.rules.add')}
          </Button>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('hosp.rules.dayClose')}</h3>
        <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('hosp.rules.cutoff')} hint={t('hosp.rules.cutoffHint')}>
            <TimeInput
              value={hhmm(d.dayClose.cutoffMin)}
              onChange={(v) => setD({ ...d, dayClose: { ...d.dayClose, cutoffMin: toMin(v) } })}
              aria-label={t('hosp.rules.cutoff')}
            />
          </Field>
          <Field label={t('hosp.rules.notes')} hint={t('hosp.rules.notesHint')}>
            <Input
              value={d.dayClose.denominations.join(', ')}
              onChange={(e) =>
                setD({
                  ...d,
                  dayClose: {
                    ...d.dayClose,
                    denominations: e.target.value
                      .split(',')
                      .map((s) => Number(s.trim()))
                      .filter((n) => n > 0),
                  },
                })
              }
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={d.dayClose.blindCash}
              onChange={(e) => setD({ ...d, dayClose: { ...d.dayClose, blindCash: e.target.checked } })}
            />
            {t('hosp.rules.blindCash')}
          </label>
        </div>
      </section>
      <Button
        variant="primary"
        disabled={save.isPending || d.discounts.some((x) => !x.name.trim())}
        onClick={() => save.mutate(undefined)}
      >
        {t('hosp.rules.save')}
      </Button>
      <Modes />
    </div>
  );
}

/** How money is taken (shared with Money set-up): hospitality adds wallet, room charge, company credit, complimentary. */
function Modes() {
  const { t } = useTranslation();
  const q = useModes();
  const [m, setM] = useState<{ name: string; kind: (typeof MODE_KINDS)[number]; needsRef: boolean }>({
    name: '',
    kind: 'ROOM',
    needsRef: true,
  });
  const add = useMoneyMutation(() => api('/api/money/modes', { method: 'POST', body: m }), t('org.saved'));
  return (
    <section className="space-y-3 border-t pt-5">
      <h3 className="text-sm font-semibold">{t('hosp.modes.title')}</h3>
      <Card className="grid max-w-2xl grid-cols-2 items-end gap-2 p-3 sm:grid-cols-[1fr_170px_auto_auto]">
        <Field label={t('org.name')}>
          <Input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />
        </Field>
        <Field label={t('hosp.modes.kind')}>
          <Select value={m.kind} onChange={(e) => setM({ ...m, kind: e.target.value as typeof m.kind })}>
            {MODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`hosp.modes.k.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex h-10 items-center gap-2 text-sm">
          <Checkbox checked={m.needsRef} onChange={(e) => setM({ ...m, needsRef: e.target.checked })} />
          {t('hosp.modes.needsRef')}
        </label>
        <Button
          variant="primary"
          disabled={!m.name.trim() || add.isPending}
          onClick={() => add.mutate(undefined, { onSuccess: () => setM({ ...m, name: '' }) })}
        >
          <Plus /> {t('hosp.rules.add')}
        </Button>
      </Card>
      <ul className="flex flex-wrap gap-1.5">
        {(q.data ?? []).map((x) => (
          <li key={x.id} className="rounded-pill border px-3 py-1 text-sm">
            {x.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
