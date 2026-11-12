import { useStructure } from '@/modules/system/branches/api';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HrRules } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { personLabel } from '@/lib/people';
import { useDepartments, useUsers } from '@/modules/system/api';
import { hm } from './api';
import { Chips, NumberChoice, Question, YesNo } from './ui';

type Props = { rules: HrRules; set: (next: HrRules) => void };

export function StepLate({ rules, set }: Props) {
  const { t } = useTranslation();
  const l = rules.late;
  const up = (p: Partial<HrRules['late']>) => set({ ...rules, late: { ...l, ...p } });
  return (
    <>
      <Question label={t('hr.w.grace')} hint={t('hr.w.graceHint')}>
        <NumberChoice
          label={t('hr.w.grace')}
          value={l.graceMinutes}
          presets={[0, 10, 15, 30]}
          unit="min"
          step={5}
          max={120}
          onChange={(v) => up({ graceMinutes: v })}
        />
      </Question>
      <Question label={t('hr.w.halfDayAfter')}>
        <NumberChoice
          label={t('hr.w.halfDayAfter')}
          value={l.halfDayAfterMinutes}
          presets={[60, 120, 150, 240]}
          unit=""
          step={15}
          min={15}
          max={600}
          show={hm}
          onChange={(v) => up({ halfDayAfterMinutes: v })}
        />
      </Question>
      <Question label={t('hr.w.fullDay')}>
        <NumberChoice
          label={t('hr.w.fullDay')}
          value={l.fullDayHours}
          presets={[4, 6, 8]}
          unit="h"
          step={0.5}
          min={1}
          max={16}
          onChange={(v) => up({ fullDayHours: v })}
        />
      </Question>
      <Question label={t('hr.w.missedOut')}>
        <Chips
          label={t('hr.w.missedOut')}
          value={l.missedPunchOut}
          onChange={(v) => up({ missedPunchOut: v })}
          options={[
            { value: 'halfDay', label: t('hr.w.missedHalf') },
            { value: 'shiftEnd', label: t('hr.w.missedShiftEnd') },
          ]}
        />
      </Question>
      <Overrides rules={rules} set={set} />
    </>
  );
}

export function StepPunches({ rules, set }: Props) {
  const { t } = useTranslation();
  const p = rules.punches;
  const up = (x: Partial<HrRules['punches']>) => set({ ...rules, punches: { ...p, ...x } });
  const blockFlag = [
    { value: 'block' as const, label: t('hr.w.block') },
    { value: 'flag' as const, label: t('hr.w.flag') },
  ];
  return (
    <>
      <Question label={t('hr.w.away')}>
        <Chips
          label={t('hr.w.away')}
          value={p.awayFromOffice}
          options={blockFlag}
          onChange={(v) => up({ awayFromOffice: v })}
        />
      </Question>
      <Question label={t('hr.w.noLocation')}>
        <Chips
          label={t('hr.w.noLocation')}
          value={p.noLocation}
          options={blockFlag}
          onChange={(v) => up({ noLocation: v })}
        />
      </Question>
      <Question label={t('hr.w.selfie')}>
        <YesNo label={t('hr.w.selfie')} value={p.selfie} onChange={(v) => up({ selfie: v })} />
      </Question>
      <Question label={t('hr.w.corrections')}>
        <NumberChoice
          label={t('hr.w.corrections')}
          value={p.correctionsPerMonth}
          presets={[0, 2, 3, 5]}
          unit=""
          max={31}
          onChange={(v) => up({ correctionsPerMonth: v })}
        />
      </Question>
      <Question label={t('hr.w.overtime')}>
        <YesNo label={t('hr.w.overtime')} value={p.overtime} onChange={(v) => up({ overtime: v })} />
      </Question>
      {p.overtime && (
        <Question label={t('hr.w.overtimeAfter')}>
          <NumberChoice
            label={t('hr.w.overtimeAfter')}
            value={p.overtimeAfterMinutes}
            presets={[0, 15, 30, 60]}
            unit="min"
            step={5}
            max={240}
            onChange={(v) => up({ overtimeAfterMinutes: v })}
          />
        </Question>
      )}
      <Overrides rules={rules} set={set} />
    </>
  );
}

/** "Different for a team or person": a few attendance answers that differ for one department or one person. */
function Overrides({ rules, set }: Props) {
  const { t } = useTranslation();
  const depts = useDepartments();
  const users = useUsers();
  const list = rules.overrides;
  const structure = useStructure();
  const places = { entities: structure.data?.entities ?? [], branches: structure.data?.branches ?? [] };
  const put = (i: number, o: HrRules['overrides'][number]) =>
    set({ ...rules, overrides: list.map((x, j) => (j === i ? o : x)) });
  return (
    <div className="space-y-2 pt-4">
      <div className="text-sm font-medium">{t('hr.w.overrides')}</div>
      {list.map((o, i) => (
        <div
          key={i}
          className="grid grid-cols-1 gap-2 rounded-control border p-3 sm:grid-cols-[140px_1fr_auto]"
        >
          <Select
            value={o.scope}
            aria-label={t('hr.w.scope')}
            onChange={(e) => put(i, { ...o, scope: e.target.value as typeof o.scope, id: '' })}
          >
            {places.entities.length > 0 && <option value="entity">{t('hrBranch.entity')}</option>}
            {places.branches.length > 1 && <option value="branch">{t('hrBranch.branch')}</option>}
            <option value="department">{t('hr.w.team')}</option>
            <option value="person">{t('hr.w.person')}</option>
          </Select>
          <Select
            value={o.id}
            aria-label={t('hr.w.who')}
            onChange={(e) => put(i, { ...o, id: e.target.value })}
          >
            <option value="">{t('org.choose')}</option>
            {o.scope === 'entity' || o.scope === 'branch'
              ? places[o.scope === 'entity' ? 'entities' : 'branches'].map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))
              : o.scope === 'department'
                ? (depts.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))
                : (users.data ?? [])
                    .filter((u) => u.status === 'ACTIVE')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {personLabel(u)}
                      </option>
                    ))}
          </Select>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('common.remove')}
            onClick={() => set({ ...rules, overrides: list.filter((_, j) => j !== i) })}
          >
            <Trash2 />
          </Button>
          <div className="space-y-2 sm:col-span-3">
            <NumberChoice
              label={t('hr.w.grace')}
              value={o.late.graceMinutes ?? rules.late.graceMinutes}
              presets={[0, 15, 30]}
              unit="min"
              step={5}
              max={120}
              onChange={(v) => put(i, { ...o, late: { ...o.late, graceMinutes: v } })}
            />
            <Chips
              label={t('hr.w.away')}
              value={o.punches.awayFromOffice ?? rules.punches.awayFromOffice}
              onChange={(v) => put(i, { ...o, punches: { ...o.punches, awayFromOffice: v } })}
              options={[
                { value: 'block', label: t('hr.w.awayBlock') },
                { value: 'flag', label: t('hr.w.awayFlag') },
              ]}
            />
          </div>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          set({ ...rules, overrides: [...list, { scope: 'department', id: '', late: {}, punches: {} }] })
        }
      >
        <Plus /> {t('hr.w.addOverride')}
      </Button>
    </div>
  );
}

export function StepLeave({ rules, set }: Props) {
  const { t } = useTranslation();
  const users = useUsers();
  const l = rules.leave;
  const up = (x: Partial<HrRules['leave']>) => set({ ...rules, leave: { ...l, ...x } });
  return (
    <>
      <Question label={t('hr.w.yearStart')}>
        <Chips
          label={t('hr.w.yearStart')}
          value={l.yearStartMonth}
          onChange={(v) => up({ yearStartMonth: v })}
          options={[
            { value: 1, label: t('hr.w.january') },
            { value: 4, label: t('hr.w.april') },
          ]}
        />
      </Question>
      <Question label={t('hr.w.compOff')}>
        <NumberChoice
          label={t('hr.w.compOff')}
          value={l.compOffValidDays}
          presets={[30, 60, 90]}
          unit={t('hr.w.days')}
          step={5}
          min={1}
          max={365}
          onChange={(v) => up({ compOffValidDays: v })}
        />
      </Question>
      <Question label={t('hr.w.hrPerson')}>
        <Select
          value={l.hrUserId ?? ''}
          aria-label={t('hr.w.hrPerson')}
          onChange={(e) => up({ hrUserId: e.target.value || null })}
        >
          <option value="">{t('hr.w.nobody')}</option>
          {(users.data ?? [])
            .filter((u) => u.status === 'ACTIVE')
            .map((u) => (
              <option key={u.id} value={u.id}>
                {personLabel(u)}
              </option>
            ))}
        </Select>
      </Question>
      <Question label={t('hr.w.notice')}>
        <NumberChoice
          label={t('hr.w.notice')}
          value={l.noticeDays}
          presets={[30, 60, 90]}
          unit={t('hr.w.days')}
          step={5}
          max={180}
          onChange={(v) => up({ noticeDays: v })}
        />
      </Question>
    </>
  );
}
