import { useTranslation } from 'react-i18next';
import { BUSINESS_TYPES, SEATS, SELL_TO, type CrmConfig, type Seat } from '@mono/shared';
import { PeoplePicker } from '@/components/people-picker';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Chips, NumberChoice, Question, YesNo } from '@/modules/hr/ui';
import { useUsers } from '@/modules/system/api';
import { type Progress } from '../api';
import { useConfigEditor } from './editors';
import { SetupCard } from './shell';

export function BusinessPage({ progress, canEdit }: { progress: Progress; canEdit: boolean }) {
  const { t } = useTranslation();
  const e = useConfigEditor(progress, 'business', ['businessType']);
  return (
    <SetupCard
      title={t('crm.s.page.business')}
      hint={t('crm.s.businessHint')}
      onSave={e.save}
      saving={e.saving}
      locked={!canEdit}
      dirty={e.dirty}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {BUSINESS_TYPES.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={e.value.businessType === b}
            onClick={() => canEdit && e.set({ businessType: b })}
            className={cn(
              'rounded-card border p-3 text-left',
              e.value.businessType === b
                ? 'border-ink bg-ink text-ink-foreground'
                : 'bg-card hover:bg-muted/40',
            )}
          >
            <div className="font-medium">{t(`crm.s.bt.${b}`)}</div>
            <div
              className={cn('text-xs', e.value.businessType === b ? 'opacity-80' : 'text-muted-foreground')}
            >
              {t(`crm.s.btHint.${b}`)}
            </div>
          </button>
        ))}
      </div>
    </SetupCard>
  );
}

export function SellToPage({ progress, canEdit }: { progress: Progress; canEdit: boolean }) {
  const { t } = useTranslation();
  const e = useConfigEditor(progress, 'sellTo', ['sellTo']);
  const toggle = (k: (typeof SELL_TO)[number]) =>
    e.set({
      sellTo: e.value.sellTo.includes(k) ? e.value.sellTo.filter((x) => x !== k) : [...e.value.sellTo, k],
    });
  return (
    <SetupCard
      title={t('crm.s.page.sellTo')}
      hint={t('crm.s.sellToHint')}
      onSave={e.save}
      saving={e.saving}
      locked={!canEdit}
      dirty={e.dirty && e.value.sellTo.length > 0}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {SELL_TO.map((k) => {
          const on = e.value.sellTo.includes(k);
          return (
            <button
              key={k}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => canEdit && toggle(k)}
              className={cn(
                'rounded-card border p-3 text-left',
                on ? 'border-ink bg-ink text-ink-foreground' : 'bg-card hover:bg-muted/40',
              )}
            >
              <div className="font-medium">{t(`crm.s.st.${k}`)}</div>
              <div className={cn('text-xs', on ? 'opacity-80' : 'text-muted-foreground')}>
                {t(`crm.s.stHint.${k}`)}
              </div>
            </button>
          );
        })}
      </div>
    </SetupCard>
  );
}

export function SeatsPage({ progress, canEdit }: { progress: Progress; canEdit: boolean }) {
  const { t } = useTranslation();
  const users = useUsers();
  const e = useConfigEditor(progress, 'seats', ['seats', 'marketingAgency']);
  const people = users.data ?? [];
  const seats = e.value.seats;
  const used = SEATS.filter((s) => (seats[s] ?? []).length || (s === 'marketing' && e.value.marketingAgency));
  const ids = new Set(Object.values(seats).flat());
  return (
    <SetupCard
      title={t('crm.s.page.seats')}
      hint={t('crm.s.seatsHint')}
      onSave={e.save}
      saving={e.saving}
      locked={!canEdit}
      dirty={e.dirty}
    >
      <p className="rounded-control bg-muted/40 px-3 py-2 text-sm">
        {t('crm.s.seatsSummary', {
          used: used.length,
          of: SEATS.length,
          people: ids.size,
          empty: SEATS.length - used.length,
        })}
      </p>
      {SEATS.map((s: Seat) => (
        <Question key={s} label={t(`crm.seat.${s}`)} hint={t(`crm.seatHint.${s}`)}>
          <PeoplePicker
            ids={seats[s] ?? []}
            people={people}
            label={t(`crm.seat.${s}`)}
            onChange={(v) => canEdit && e.set({ seats: { ...seats, [s]: v } })}
          />
          {s === 'marketing' && (
            <Field label={t('crm.s.agency')}>
              <Input
                value={e.value.marketingAgency ?? ''}
                disabled={!canEdit}
                onChange={(ev) => e.set({ marketingAgency: ev.target.value || null })}
              />
            </Field>
          )}
        </Question>
      ))}
    </SetupCard>
  );
}

export function CustomerRulesPage({ progress, canEdit }: { progress: Progress; canEdit: boolean }) {
  const { t } = useTranslation();
  const e = useConfigEditor(progress, 'customerRules', ['customers']);
  const c = e.value.customers;
  const up = (x: Partial<CrmConfig['customers']>) => canEdit && e.set({ customers: { ...c, ...x } });
  const days = t('hr.w.days');
  return (
    <SetupCard
      title={t('crm.s.page.customerRules')}
      hint={t('crm.s.customerRulesHint')}
      onSave={e.save}
      saving={e.saving}
      locked={!canEdit}
      dirty={e.dirty}
    >
      <Question label={t('crm.s.newUntilOrders')}>
        <NumberChoice
          label={t('crm.s.newUntilOrders')}
          value={c.newOrders}
          presets={[1, 2, 3, 5]}
          unit={t('crm.s.orders')}
          min={1}
          max={50}
          onChange={(newOrders) => up({ newOrders })}
        />
      </Question>
      <Question label={t('crm.s.newUntilDays')}>
        <NumberChoice
          label={t('crm.s.newUntilDays')}
          value={c.newDays}
          presets={[30, 60, 90, 180]}
          unit={days}
          step={5}
          min={1}
          max={730}
          onChange={(newDays) => up({ newDays })}
        />
      </Question>
      <Question label={t('crm.s.newRule')}>
        <Chips
          label={t('crm.s.newRule')}
          value={c.newRule}
          onChange={(newRule) => up({ newRule })}
          options={[
            { value: 'first', label: t('crm.s.whicheverFirst') },
            { value: 'both', label: t('crm.s.both') },
          ]}
        />
      </Question>
      <Question label={t('crm.s.sleepingAfter')}>
        <NumberChoice
          label={t('crm.s.sleepingAfter')}
          value={c.sleepingDays}
          presets={[30, 45, 60, 90]}
          unit={days}
          step={5}
          min={7}
          max={730}
          onChange={(sleepingDays) => up({ sleepingDays })}
        />
      </Question>
      <Question label={t('crm.s.lostAfter')} hint={t('crm.s.winBackHint')}>
        <NumberChoice
          label={t('crm.s.lostAfter')}
          value={c.lostDays}
          presets={[90, 120, 180, 365]}
          unit={days}
          step={15}
          min={14}
          max={1095}
          onChange={(lostDays) => up({ lostDays })}
        />
      </Question>
      <Question label={t('crm.s.vampireOn')} hint={t('crm.s.vampireHint')}>
        <YesNo label={t('crm.s.vampireOn')} value={c.vampire} onChange={(vampire) => up({ vampire })} />
      </Question>
    </SetupCard>
  );
}
