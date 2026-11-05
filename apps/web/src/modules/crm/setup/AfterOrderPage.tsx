import { ExternalLink, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DEFAULT_AFTER_ORDER, SEATS, type AfterOrderStep } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { type Progress } from '../api';
import { useConfigEditor } from './editors';
import { SetupCard } from './shell';

const ANCHORS = ['start', 'previous', 'promised', 'paymentDue'] as const;

/** CRM configuration 6: the steps after an order — a real FMS flow under the hood (published on save). */
export function AfterOrderPage({ progress, canEdit }: { progress: Progress; canEdit: boolean }) {
  const { t } = useTranslation();
  const e = useConfigEditor(progress, 'afterOrder', ['afterOrder']);
  const steps = e.value.afterOrder;
  const put = (i: number, x: Partial<AfterOrderStep>) =>
    canEdit && e.set({ afterOrder: steps.map((s, k) => (k === i ? { ...s, ...x } : s)) });
  const keyOf = (name: string) => {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/^(\d)/, 's$1')
        .slice(0, 30) || 'step';
    let k = base;
    for (let n = 2; steps.some((s) => s.key === k); n++) k = `${base}_${n}`;
    return k;
  };
  const ok = steps.every((s) => s.name.trim().length >= 2) && steps.length > 0;
  return (
    <SetupCard
      title={t('crm.s.page.afterOrder')}
      hint={t('crm.s.afterOrderHint')}
      onSave={e.save}
      saving={e.saving}
      locked={!canEdit}
      dirty={e.dirty && ok}
      saveLabel={t('crm.s.savePublish')}
    >
      {progress.afterOrderFlowId && (
        <Link
          to={`/fms/builder/${progress.afterOrderFlowId}`}
          className="inline-flex items-center gap-1 text-sm underline"
        >
          <ExternalLink className="size-3.5" /> {t('crm.s.openFlow')}
        </Link>
      )}
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={s.key} className="grid gap-2 rounded-control border p-3 sm:grid-cols-[1.4fr_1fr_auto]">
            <Input
              aria-label={t('crm.s.stepName')}
              value={s.name}
              disabled={!canEdit}
              onChange={(ev) => put(i, { name: ev.target.value })}
            />
            <Select
              value={s.seat}
              aria-label={t('crm.s.seat')}
              onChange={(ev) => put(i, { seat: ev.target.value as AfterOrderStep['seat'] })}
              disabled={!canEdit}
            >
              {SEATS.map((x) => (
                <option key={x} value={x}>
                  {t(`crm.seat.${x}`)}
                </option>
              ))}
            </Select>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('common.remove')}
              disabled={!canEdit || steps.length < 2}
              onClick={() => e.set({ afterOrder: steps.filter((_, k) => k !== i) })}
            >
              <Trash2 />
            </Button>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
              <Input
                aria-label={t('crm.s.howLong')}
                inputMode="numeric"
                value={s.time.value}
                disabled={!canEdit}
                onChange={(ev) =>
                  put(i, {
                    time: { ...s.time, value: Math.max(0, Math.min(1000, Number(ev.target.value) || 0)) },
                  })
                }
                className="w-20 tabular-nums"
              />
              <Select
                value={s.time.unit}
                aria-label={t('crm.s.unit')}
                onChange={(ev) => put(i, { time: { ...s.time, unit: ev.target.value as 'hours' | 'days' } })}
                disabled={!canEdit}
                className="w-28"
              >
                <option value="hours">{t('crm.s.hours')}</option>
                <option value="days">{t('hr.w.days')}</option>
              </Select>
              <Select
                value={s.time.anchor}
                aria-label={t('crm.s.anchor')}
                onChange={(ev) =>
                  put(i, { time: { ...s.time, anchor: ev.target.value as AfterOrderStep['time']['anchor'] } })
                }
                disabled={!canEdit}
                className="min-w-48"
              >
                {ANCHORS.map((a) => (
                  <option key={a} value={a}>
                    {t(`crm.s.anchors.${a}`)}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={s.proof}
                  disabled={!canEdit}
                  onChange={(ev) => put(i, { proof: ev.target.checked })}
                />{' '}
                {t('crm.s.proof')}
              </label>
            </div>
            <Input
              aria-label={t('crm.s.documents')}
              placeholder={t('crm.s.documentsPh')}
              value={s.documents.join(', ')}
              disabled={!canEdit}
              onChange={(ev) =>
                put(i, {
                  documents: ev.target.value
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .slice(0, 6),
                })
              }
              className="sm:col-span-3"
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!canEdit || steps.length >= 15}
          onClick={() =>
            e.set({
              afterOrder: [
                ...steps,
                {
                  key: keyOf(t('crm.s.newStep')),
                  name: t('crm.s.newStep'),
                  seat: 'crm',
                  time: { value: 1, unit: 'days', anchor: 'previous' },
                  documents: [],
                  proof: false,
                },
              ],
            })
          }
        >
          <Plus /> {t('crm.s.addStep')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!canEdit}
          onClick={() => e.set({ afterOrder: DEFAULT_AFTER_ORDER })}
        >
          <RotateCcw /> {t('crm.s.resetDefault')}
        </Button>
      </div>
    </SetupCard>
  );
}
