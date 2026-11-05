import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { seatTargets } from '@mono/shared';
import { Field, Switch } from '@/components/ui/form';
import { useUsers } from '@/modules/system/api';
import { inr, toPaise, type PlanData, type Progress } from '../api';
import { useConfigEditor } from './editors';
import { MoneyInput, SetupCard, Stat } from './shell';
import { rupeeText } from './format';

/** CRM configuration 4: CRR / NBD share, the owner's own clients, each seat's month-by-month target, science check. */
export function SplitPage({
  progress,
  plan,
  canEdit,
}: {
  progress: Progress;
  plan: PlanData;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const users = useUsers();
  const e = useConfigEditor(progress, 'split', ['split']);
  const [owner, setOwner] = useState(rupeeText(e.value.split.ownerAmount));
  const split = e.value.split;
  const up = (x: Partial<typeof split>) => canEdit && e.set({ split: { ...split, ...x } });
  const months = plan.view.months.map((m) => m.turnover);
  const s = seatTargets(months, e.value, plan.input.roundUnit);
  const name = new Map((users.data ?? []).map((u) => [u.id, u.name]));
  const mon = (m: string) =>
    new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${m}-01T00:00:00Z`));
  return (
    <SetupCard
      title={t('crm.s.page.split')}
      hint={t('crm.s.splitHint')}
      onSave={e.save}
      saving={e.saving}
      locked={!canEdit}
      dirty={e.dirty}
    >
      <Field label={t('crm.s.crrShare', { crr: split.crrPct, nbd: 100 - split.crrPct })}>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={split.crrPct}
          disabled={!canEdit}
          onChange={(ev) => up({ crrPct: Number(ev.target.value) })}
          className="w-full accent-[var(--primary)]"
          aria-label={t('crm.s.crrShare', { crr: split.crrPct, nbd: 100 - split.crrPct })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat big label={t('crm.s.crr')} value={inr(s.crr, true)} sub={t('crm.s.crrSub')} />
        <Stat label={t('crm.s.nbd')} value={inr(s.nbd, true)} sub={t('crm.s.nbdSub')} />
        <Stat label={t('crm.s.ownerCut')} value={inr(s.owner, true)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={split.gpFollows}
          disabled={!canEdit}
          onCheckedChange={(gpFollows) => up({ gpFollows })}
        />{' '}
        {t('crm.s.gpFollows')}
      </label>
      <Field label={t('crm.s.ownerAmount')} hint={t('crm.s.ownerAmountHint')}>
        <MoneyInput
          label={t('crm.s.ownerAmount')}
          value={owner}
          disabled={!canEdit}
          onChange={(v) => (setOwner(v), up({ ownerAmount: toPaise(v) ?? 0 }))}
        />
      </Field>
      <div className="overflow-x-auto rounded-card border">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-muted/60 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">{t('crm.s.seat')}</th>
              {plan.view.months.map((m) => (
                <th key={m.month} className="px-2 py-2 text-right font-medium">
                  {mon(m.month)}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">{t('crm.s.yearCol')}</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="whitespace-nowrap px-2 py-1.5">
                  <div className="font-medium">
                    {r.userId ? (name.get(r.userId) ?? '?') : t('crm.s.nobody')}
                  </div>
                  <div className="text-muted-foreground">{t(`crm.seat.${r.seat}`)}</div>
                </td>
                {r.months.map((v, k) => (
                  <td key={k} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {inr(v, true)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">
                  {inr(r.year, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium">{t('crm.s.science')}</div>
        {!s.warnings.length ? (
          <p className="flex items-center gap-2 text-sm text-status-ok-fg">
            <CheckCircle2 className="size-4" /> {t('crm.s.scienceOk')}
          </p>
        ) : (
          <ul className="space-y-1">
            {s.warnings.map((w, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-status-warn-fg">
                <TriangleAlert className="size-4" />{' '}
                {t(`crm.s.warn.${w.code}`, { seat: w.seat ? t(`crm.seat.${w.seat}`) : '' })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SetupCard>
  );
}
