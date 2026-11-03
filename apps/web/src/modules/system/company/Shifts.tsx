import { Clock, Moon, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shiftSchema } from '@mono/shared';
import { TimeInput } from '@/components/ui/date-input';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Checkbox, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { del, patch, post, useOrgMutation, useShifts, type Shift } from '../api';

const DAYS = [1, 2, 3, 4, 5, 6, 7];
type Draft = {
  id?: string;
  name: string;
  start: string;
  end: string;
  weekdays: number[];
  isDefault: boolean;
};
const NEW: Draft = { name: '', start: '09:00', end: '18:00', weekdays: [1, 2, 3, 4, 5, 6], isDefault: false };

export function DayChips({ value, onChange }: { value: number[]; onChange?: (v: number[]) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1.5">
      {DAYS.map((d) => {
        const on = value.includes(d);
        const cls = cn(
          'grid h-8 min-w-10 place-items-center rounded-pill px-2 text-xs font-semibold',
          on
            ? 'bg-accent-soft text-accent-soft-foreground'
            : 'bg-muted text-muted-foreground line-through decoration-1',
        );
        return onChange ? (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            className={cls}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
          >
            {t(`org.day.${d}`)}
          </button>
        ) : (
          <span key={d} className={cls}>
            {t(`org.day.${d}`)}
          </span>
        );
      })}
    </div>
  );
}

export function Shifts() {
  const { t } = useTranslation();
  const q = useShifts();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useOrgMutation(
    ({ id, ...body }: Draft) => (id ? patch(`/api/org/shifts/${id}`, body) : post('/api/org/shifts', body)),
    { success: t('org.saved') },
  );
  const remove = useOrgMutation((id: string) => del(`/api/org/shifts/${id}`), { success: t('org.deleted') });
  const makeDefault = useOrgMutation((id: string) => patch(`/api/org/shifts/${id}`, { isDefault: true }));

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  const submit = () => {
    if (!draft) return;
    const parsed = shiftSchema.safeParse(draft);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
    save.mutate(draft, { onSuccess: () => setDraft(null) });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => (setError(null), setDraft(NEW))}>
          <Plus /> {t('org.shifts.add')}
        </Button>
      </div>
      {q.data.length === 0 ? (
        <EmptyState icon={Clock} title={t('org.shifts.emptyTitle')} body={t('org.shifts.emptyBody')} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((s: Shift) => (
            <Card key={s.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {s.name}
                    {s.isDefault && (
                      <Badge className="bg-accent-soft text-accent-soft-foreground">{t('org.default')}</Badge>
                    )}
                  </div>
                  <div className="tabular mt-0.5 flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
                    {s.start}–{s.end}
                    {s.overnight && (
                      <Moon className="size-4 text-muted-foreground" aria-label={t('org.shifts.overnight')} />
                    )}
                  </div>
                </div>
                <div className="flex">
                  {!s.isDefault && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('org.shifts.setDefault')}
                      onClick={() => makeDefault.mutate(s.id)}
                    >
                      <Star />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('org.edit')}
                    onClick={() => (setError(null), setDraft({ ...s }))}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('org.delete')}
                    onClick={() => remove.mutate(s.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <DayChips value={s.weekdays} />
              <div className="text-xs text-muted-foreground">{t('org.peopleCount', { count: s.people })}</div>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={!!draft}
        onOpenChange={(o) => !o && setDraft(null)}
        title={draft?.id ? t('org.shifts.edit') : t('org.shifts.add')}
        footer={
          <Button variant="primary" onClick={submit} disabled={save.isPending}>
            {t('common.save')}
          </Button>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Field label={t('org.name')}>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t('org.shifts.namePh')}
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('org.shifts.start')}>
                <TimeInput value={draft.start} onChange={(v) => setDraft({ ...draft, start: v })} />
              </Field>
              <Field
                label={t('org.shifts.end')}
                hint={draft.end <= draft.start ? t('org.shifts.overnightHint') : undefined}
              >
                <TimeInput value={draft.end} onChange={(v) => setDraft({ ...draft, end: v })} />
              </Field>
            </div>
            <Field label={t('org.shifts.days')}>
              <DayChips value={draft.weekdays} onChange={(weekdays) => setDraft({ ...draft, weekdays })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.isDefault}
                onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
              />
              {t('org.shifts.setDefault')}
            </label>
            {error && <p className="text-sm text-status-bad-fg">{error}</p>}
          </div>
        )}
      </Dialog>
    </div>
  );
}
