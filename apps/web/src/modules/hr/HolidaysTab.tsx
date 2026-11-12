import { useStructure } from '@/modules/system/branches/api';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { financialYear, formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { hrApi, useHrCalendar, useHrMutation } from './api';
import { Chips } from './ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type Kind = 'WORKING' | 'HALF' | 'OFF';

/** Holiday calendar of the year and the weekly offs (shared with FMS times, checklists and leave days). */
export function HolidaysTab({ me }: { me: Me }) {
  const { t } = useTranslation();
  const admin = hasPermission(me.user.permissions, 'hr.admin');
  const fy = financialYear(new Date(), me.company.timezone);
  const from = `${fy.start}-04-01`;
  const to = `${fy.end}-03-31`;
  const q = useHrCalendar(from, to);
  const [h, setH] = useState({ date: '', name: '', type: 'FESTIVAL', halfDay: false });
  // Who a holiday is for (phase 12): everyone, a country, a state, a legal entity or one branch.
  const [who, setWho] = useState('');
  const structure = useStructure();
  const entities = structure.data?.entities ?? [];
  const branches = structure.data?.branches ?? [];
  const countries = [...new Set(entities.map((e) => e.country))];
  const states = [
    ...new Set([...entities, ...branches].map((x) => x.state).filter((x): x is string => Boolean(x))),
  ];
  const forWhom = () => ({
    country: who.startsWith('c:') ? who.slice(2) : null,
    state: who.startsWith('s:') ? who.slice(2) : null,
    entityId: who.startsWith('e:') ? who.slice(2) : null,
    branchId: who.startsWith('b:') ? who.slice(2) : null,
  });
  const whoLabel = (x: {
    branchId: string | null;
    entityId?: string | null;
    state?: string | null;
    country?: string | null;
  }) =>
    x.branchId
      ? branches.find((b) => b.id === x.branchId)?.name
      : x.entityId
        ? entities.find((e) => e.id === x.entityId)?.name
        : (x.state ?? x.country ?? null);
  const add = useHrMutation(
    () => hrApi.saveHoliday({ ...h, ...forWhom() }),
    () => t('org.saved'),
  );
  const del = useHrMutation(
    (id: string) => hrApi.deleteHoliday(id),
    () => t('hr.h.deleted'),
  );
  const company = q.data?.weeklyOffs.filter((w) => !w.branchId) ?? [];
  const [week, setWeek] = useState<Kind[] | null>(null);
  const current: Kind[] =
    week ??
    DAYS.map((_, i) => company.find((w) => w.weekday === i + 1)?.kind ?? (i === 6 ? 'OFF' : 'WORKING'));
  const saveWeek = useHrMutation(
    () => hrApi.saveWeeklyOffs({ days: current.map((kind, i) => ({ weekday: i + 1, kind })) }),
    () => t('org.saved'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.h.title', { fy: fy.label })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {admin && (
              <div className="grid grid-cols-1 gap-2 rounded-control border p-3 @xl:grid-cols-[160px_1fr_140px_auto_auto] @xl:items-end">
                <Field label={t('hr.h.date')}>
                  <DateInput value={h.date} onChange={(v) => setH({ ...h, date: v })} />
                </Field>
                <Field label={t('hr.h.name')}>
                  <Input
                    value={h.name}
                    onChange={(e) => setH({ ...h, name: e.target.value })}
                    placeholder="Diwali"
                  />
                </Field>
                <Field label={t('hr.h.type')}>
                  <Select value={h.type} onChange={(e) => setH({ ...h, type: e.target.value })}>
                    {['FESTIVAL', 'NATIONAL', 'OPTIONAL'].map((x) => (
                      <option key={x} value={x}>
                        {t(`hr.h.kind.${x}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {(entities.length > 0 || branches.length > 1) && (
                  <Field label={t('holidayFor.label')}>
                    <Select value={who} onChange={(e) => setWho(e.target.value)}>
                      <option value="">{t('holidayFor.everyone')}</option>
                      {countries.map((c) => (
                        <option key={c} value={`c:${c}`}>
                          {t('holidayFor.country', { name: c })}
                        </option>
                      ))}
                      {states.map((s) => (
                        <option key={s} value={`s:${s}`}>
                          {t('holidayFor.state', { name: s })}
                        </option>
                      ))}
                      {entities.map((e) => (
                        <option key={e.id} value={`e:${e.id}`}>
                          {e.name}
                        </option>
                      ))}
                      {branches.map((b) => (
                        <option key={b.id} value={`b:${b.id}`}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <label className="flex h-10 items-center gap-2 text-sm">
                  <Switch
                    checked={h.halfDay}
                    onCheckedChange={(v) => setH({ ...h, halfDay: v })}
                    aria-label={t('hr.h.half')}
                  />{' '}
                  {t('hr.h.half')}
                </label>
                <Button
                  disabled={!h.date || h.name.trim().length < 2 || add.isPending}
                  onClick={() =>
                    add.mutate(undefined, {
                      onSuccess: () => setH({ date: '', name: '', type: 'FESTIVAL', halfDay: false }),
                    })
                  }
                >
                  {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('hr.h.add')}
                </Button>
              </div>
            )}
            {q.data.holidays.length ? (
              <ul className="divide-y text-sm">
                {q.data.holidays.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium tabular-nums">{formatLocalDate(x.date)}</span> · {x.name}
                      <span className="text-muted-foreground">
                        {' '}
                        · {t(`hr.h.kind.${x.type}`)}
                        {x.halfDay ? ` · ${t('hr.h.half')}` : ''}
                        {whoLabel(x) ? ` · ${t('holidayFor.only', { name: whoLabel(x) })}` : ''}
                      </span>
                    </span>
                    {admin && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('common.delete')}
                        onClick={() => del.mutate(x.id)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('hr.h.none')}</p>
            )}
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>{t('hr.h.weekly')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {DAYS.map((d, i) => (
              <div key={d} className="flex items-center justify-between gap-2">
                <span className="w-10 text-sm font-medium">{t(`hr.day.${d}`)}</span>
                {admin ? (
                  <Chips
                    label={t(`hr.day.${d}`)}
                    value={current[i]!}
                    onChange={(v) => setWeek(current.map((k, j) => (j === i ? v : k)))}
                    options={(['WORKING', 'HALF', 'OFF'] as const).map((k) => ({
                      value: k,
                      label: t(`hr.h.${k}`),
                    }))}
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">{t(`hr.h.${current[i]}`)}</span>
                )}
              </div>
            ))}
            {admin && (
              <Button
                variant="primary"
                disabled={!week || saveWeek.isPending}
                onClick={() => saveWeek.mutate(undefined, { onSuccess: () => setWeek(null) })}
              >
                {t('common.save')}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">{t('hr.h.weeklyHint')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
