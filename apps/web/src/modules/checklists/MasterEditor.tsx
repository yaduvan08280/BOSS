import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checklistMasterSchema,
  localDate,
  type Frequency,
  type OrgDepartment,
  type OrgPerson,
} from '@mono/shared';
import { DateInput, TimeInput } from '@/components/ui/date-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DayChips } from '@/modules/system/company/Shifts';
import { useChecklistMutation, type Master } from './api';

type Draft = Omit<Master, 'id' | 'code'>;
const newKey = () => Math.random().toString(36).slice(2, 8);

const blank = (tz: string, windowHours = 4): Draft => ({
  name: '',
  departmentId: null,
  branchId: null,
  items: [{ key: newKey(), text: '', requirePhoto: false, requireVoice: false, requireValue: false }],
  frequency: { type: 'daily' },
  dueTime: '10:00',
  windowHours,
  doerIds: [],
  verifierId: null,
  skipHolidays: true,
  startDate: localDate(new Date(), tz),
  active: true,
});

function FrequencyPicker({ value, onChange }: { value: Frequency; onChange: (f: Frequency) => void }) {
  const { t } = useTranslation();
  const set = (type: Frequency['type']) => {
    const next: Record<Frequency['type'], Frequency> = {
      daily: { type: 'daily' },
      weekdays: { type: 'weekdays', weekdays: [1, 2, 3, 4, 5, 6] },
      weekly: { type: 'weekly', weekday: 1 },
      monthly: { type: 'monthly', day: 1 },
      quarterly: { type: 'quarterly', day: 1 },
      yearly: { type: 'yearly', month: 4, day: 1 },
      everyN: { type: 'everyN', everyN: 2 },
    };
    onChange(next[type]);
  };
  const dayInput = (day: number | 'last', apply: (d: number | 'last') => void) => (
    <Select
      value={String(day)}
      onChange={(e) => apply(e.target.value === 'last' ? 'last' : Number(e.target.value))}
      className="w-36"
    >
      {Array.from({ length: 31 }, (_, i) => (
        <option key={i + 1} value={i + 1}>
          {t('chk.freq.dayN', { n: i + 1 })}
        </option>
      ))}
      <option value="last">{t('chk.freq.lastDay')}</option>
    </Select>
  );
  return (
    <div className="space-y-3">
      <Select value={value.type} onChange={(e) => set(e.target.value as Frequency['type'])}>
        {(['daily', 'weekdays', 'weekly', 'monthly', 'quarterly', 'yearly', 'everyN'] as const).map((k) => (
          <option key={k} value={k}>
            {t(`chk.freq.${k}`)}
          </option>
        ))}
      </Select>
      {value.type === 'weekdays' && (
        <DayChips
          value={value.weekdays}
          onChange={(weekdays) => onChange({ type: 'weekdays', weekdays: weekdays.length ? weekdays : [1] })}
        />
      )}
      {value.type === 'weekly' && (
        <Select
          value={value.weekday}
          onChange={(e) => onChange({ type: 'weekly', weekday: Number(e.target.value) })}
        >
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <option key={d} value={d}>
              {t(`org.day.${d}`)}
            </option>
          ))}
        </Select>
      )}
      {(value.type === 'monthly' || value.type === 'quarterly') &&
        dayInput(value.day, (day) => onChange({ type: value.type, day } as Frequency))}
      {value.type === 'yearly' && (
        <div className="flex gap-2">
          <Select value={value.month} onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2026, i, 1).toLocaleString('en-IN', { month: 'long' })}
              </option>
            ))}
          </Select>
          {dayInput(value.day, (day) => onChange({ ...value, day: day === 'last' ? 31 : day }))}
        </div>
      )}
      {value.type === 'everyN' && (
        <div className="flex items-center gap-2 text-sm">
          {t('chk.freq.every')}
          <Input
            type="number"
            min={2}
            max={365}
            className="w-24"
            value={value.everyN}
            onChange={(e) => onChange({ type: 'everyN', everyN: Math.max(2, Number(e.target.value) || 2) })}
          />
          {t('chk.freq.days')}
        </div>
      )}
    </div>
  );
}

/** Create or edit a checklist master (CLAUDE.md §5.2). */
export function MasterEditor({
  master,
  people,
  departments,
  tz,
  onDone,
  windowHours,
}: {
  master?: Master;
  people: OrgPerson[];
  departments: OrgDepartment[];
  tz: string;
  onDone: () => void;
  /** New checklists start with the company's "mark missed after" time. */
  windowHours?: number;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState<Draft>(() => (master ? { ...master } : blank(tz, windowHours)));
  const [error, setError] = useState<string | null>(null);
  const save = useChecklistMutation(
    (body: unknown) =>
      master
        ? api(`/api/checklists/masters/${master.id}`, { method: 'PATCH', body })
        : api('/api/checklists/masters', { method: 'POST', body }),
    t('org.saved'),
  );
  const active = people.filter((p) => p.status === 'ACTIVE');
  const setItem = (i: number, patch: Partial<Draft['items'][number]>) =>
    setD({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const move = (i: number, dir: -1 | 1) => {
    const items = [...d.items];
    const [it] = items.splice(i, 1);
    items.splice(i + dir, 0, it!);
    setD({ ...d, items });
  };
  const submit = () => {
    const body = { ...d, items: d.items.filter((it) => it.text.trim()) };
    const parsed = checklistMasterSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
    setError(null);
    save.mutate(parsed.data, { onSuccess: () => (!master && setD(blank(tz, windowHours)), onDone()) });
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>{master ? `${master.code} · ${master.name}` : t('chk.newMaster')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={`${t('org.name')} *`}>
              <Input
                value={d.name}
                onChange={(e) => setD({ ...d, name: e.target.value })}
                placeholder={t('chk.namePh')}
              />
            </Field>
            <Field label={t('org.users.dept')}>
              <Select
                value={d.departmentId ?? ''}
                onChange={(e) => setD({ ...d, departmentId: e.target.value || null })}
              >
                <option value="">—</option>
                {departments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">{t('chk.items')}</div>
            <ol className="space-y-2">
              {d.items.map((it, i) => (
                <li key={it.key} className="rounded-control border p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="tabular w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
                    <Input
                      value={it.text}
                      onChange={(e) => setItem(i, { text: e.target.value })}
                      placeholder={t('chk.itemPh')}
                      className="h-9 sm:h-9"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={t('chk.up')}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === d.items.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={t('chk.down')}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={d.items.length === 1}
                      onClick={() => setD({ ...d, items: d.items.filter((_, j) => j !== i) })}
                      aria-label={t('org.delete')}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-7 text-xs">
                    {(['requirePhoto', 'requireVoice', 'requireValue'] as const).map((k) => (
                      <label key={k} className="flex items-center gap-1.5">
                        <Checkbox checked={it[k]} onChange={(e) => setItem(i, { [k]: e.target.checked })} />{' '}
                        {t(`chk.${k}`)}
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <Button
              size="sm"
              className="mt-2"
              onClick={() =>
                setD({
                  ...d,
                  items: [
                    ...d.items,
                    {
                      key: newKey(),
                      text: '',
                      requirePhoto: false,
                      requireVoice: false,
                      requireValue: false,
                    },
                  ],
                })
              }
            >
              <Plus /> {t('chk.addItem')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="self-start">
        <CardHeader>
          <CardTitle>{t('chk.when')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={t('chk.frequency')}>
            <FrequencyPicker value={d.frequency} onChange={(frequency) => setD({ ...d, frequency })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('chk.dueTime')}>
              <TimeInput value={d.dueTime} onChange={(v) => setD({ ...d, dueTime: v })} />
            </Field>
            <Field label={t('chk.window')} hint={t('chk.windowHint')}>
              <Input
                type="number"
                min={1}
                max={72}
                value={d.windowHours}
                onChange={(e) => setD({ ...d, windowHours: Number(e.target.value) || 1 })}
              />
            </Field>
          </div>
          <Field label={`${t('chk.doers')} *`}>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {active.map((p) => {
                const on = d.doerIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setD({ ...d, doerIds: on ? d.doerIds.filter((x) => x !== p.id) : [...d.doerIds, p.id] })
                    }
                    className={cn(
                      'h-8 rounded-pill border px-3 text-xs font-medium',
                      on
                        ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                        : 'bg-card text-muted-foreground',
                    )}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={t('task.verifier')}>
            <Select
              value={d.verifierId ?? ''}
              onChange={(e) => setD({ ...d, verifierId: e.target.value || null })}
            >
              <option value="">{t('chk.defaultVerifier')}</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('chk.startDate')}>
            <DateInput value={d.startDate} onChange={(v) => setD({ ...d, startDate: v })} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={d.skipHolidays}
              onChange={(e) => setD({ ...d, skipHolidays: e.target.checked })}
            />{' '}
            {t('chk.skipHolidays')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />{' '}
            {t('chk.active')}
          </label>
          {error && <p className="text-sm text-status-bad-fg">{error}</p>}
          <Button variant="primary" className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending && <Loader2 className="animate-spin" />}{' '}
            {master ? t('common.save') : t('chk.create')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
