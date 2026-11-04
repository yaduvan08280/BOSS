import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AUTO_ACTIONS, END, STEP_TYPES, type FlowStep, type OrgPerson, type StepTime } from '@mono/shared';
import { TimeInput } from '@/components/ui/date-input';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PeoplePicker } from '@/components/people-picker';
import { FieldsEditor } from './FieldsEditor';

type Props = {
  step: FlowStep;
  steps: FlowStep[];
  people: OrgPerson[];
  docTypes: { code: string; name: string }[];
  /** Every field of the flow (dates anchor times; item lines feed stock steps). */
  fields: { key: string; label: string; type: string }[];
  onChange: (s: FlowStep) => void;
  onDelete: () => void;
};

/** The selected step: type, who, time, checklist, entry form, documents, proof, where it leads. */
export function StepEditor({ step, steps, people, docTypes, fields, onChange, onDelete }: Props) {
  const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
  const itemFields = fields.filter((f) => f.type === 'items');
  const { t } = useTranslation();
  const set = (patch: Partial<FlowStep>) => onChange({ ...step, ...patch });
  const time: StepTime = step.time ?? { value: 1, unit: 'hours', anchor: 'previous' };
  const setTime = (patch: Partial<StepTime>) => set({ time: { ...time, ...patch } });
  const targets = [
    ...steps
      .filter((s) => s.key !== step.key)
      .map((s, i) => ({ key: s.key, label: `${steps.indexOf(s) + 1 || i + 1}. ${s.name}` })),
    { key: END, label: t('fms.b.end') },
  ];
  const target = (
    value: string | undefined,
    onSet: (v: string | undefined) => void,
    label: string,
    allowDefault = true,
  ) => (
    <Field label={label}>
      <Select value={value ?? ''} onChange={(e) => onSet(e.target.value || undefined)}>
        {allowDefault && <option value="">{t('fms.b.nextInList')}</option>}
        {!allowDefault && <option value="">{t('org.choose')}</option>}
        {targets.map((x) => (
          <option key={x.key} value={x.key}>
            {x.label}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-2">
        <Field label={t('fms.b.stepName')} className="flex-1">
          <Input value={step.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Button variant="ghost" size="icon" aria-label={t('fms.b.deleteStep')} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('fms.b.type')}</legend>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {STEP_TYPES.map((ty) => (
            <button
              key={ty}
              type="button"
              aria-pressed={step.type === ty}
              onClick={() => set({ type: ty })}
              className={cn(
                'rounded-control border p-2 text-left text-xs',
                step.type === ty ? 'border-primary bg-primary/10 font-semibold' : 'bg-card',
              )}
            >
              <div className="text-sm">{t(`fms.st.${ty}`)}</div>
              <div className="text-[11px] text-muted-foreground">{t(`fms.stHint.${ty}`)}</div>
            </button>
          ))}
        </div>
      </fieldset>

      {step.type !== 'AUTO' && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t('fms.b.who')}</h3>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={step.starter} onChange={(e) => set({ starter: e.target.checked })} />
            {t('fms.b.starter')}
          </label>
          {!step.starter && (
            <PeoplePicker
              ids={step.doerIds}
              people={people}
              label={t('fms.b.doers')}
              onChange={(doerIds) => set({ doerIds })}
            />
          )}
          <Field label={t('fms.b.backups')}>
            <PeoplePicker
              ids={step.backupIds}
              people={people}
              label={t('fms.b.backups')}
              onChange={(backupIds) => set({ backupIds })}
            />
          </Field>
        </section>
      )}

      {step.type !== 'AUTO' && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t('fms.b.time')}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label={t('fms.b.anchor')} className="col-span-2">
              <Select
                value={time.anchor}
                onChange={(e) => setTime({ anchor: e.target.value as StepTime['anchor'] })}
              >
                {(['previous', 'start', 'dateField', 'fixed'] as const).map((a) => (
                  <option key={a} value={a}>
                    {t(`fms.anchor.${a}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {time.anchor === 'fixed' ? (
              <Field label={t('fms.b.at')}>
                <TimeInput value={time.at ?? '10:00'} onChange={(at) => setTime({ at })} />
              </Field>
            ) : (
              <>
                <Field label={t('fms.b.value')}>
                  <Input
                    inputMode="decimal"
                    value={String(time.value)}
                    onChange={(e) => setTime({ value: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field label={t('fms.b.unit')}>
                  <Select
                    value={time.unit}
                    onChange={(e) => setTime({ unit: e.target.value as StepTime['unit'] })}
                  >
                    {(['minutes', 'hours', 'days'] as const).map((u) => (
                      <option key={u} value={u}>
                        {t(`fms.unit.${u}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            {time.anchor === 'dateField' && (
              <>
                <Field label={t('fms.b.dateField')} className="col-span-2">
                  <Select value={time.field ?? ''} onChange={(e) => setTime({ field: e.target.value })}>
                    <option value="">{t('org.choose')}</option>
                    {dateFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('fms.b.beforeAfter')} className="col-span-2">
                  <Select
                    value={time.before ? 'before' : 'after'}
                    onChange={(e) => setTime({ before: e.target.value === 'before' })}
                  >
                    <option value="before">{t('fms.b.before')}</option>
                    <option value="after">{t('fms.b.after')}</option>
                  </Select>
                </Field>
              </>
            )}
          </div>
          {!step.time && <p className="text-xs text-status-bad-fg">{t('fms.b.setTime')}</p>}
          {!step.time && (
            <Button size="sm" onClick={() => set({ time })}>
              {t('fms.b.useThisTime')}
            </Button>
          )}
        </section>
      )}

      {step.type === 'DECISION' && (
        <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {target(step.yes, (yes) => set({ yes }), t('fms.b.ifYes'), false)}
          {target(step.no, (no) => set({ no }), t('fms.b.ifNo'), false)}
        </section>
      )}
      {step.type === 'APPROVAL' &&
        target(step.rejectTo, (rejectTo) => set({ rejectTo }), t('fms.b.ifRejected'))}
      {step.type !== 'DECISION' && target(step.next, (next) => set({ next }), t('fms.b.next'))}

      {step.type === 'AUTO' ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t('fms.b.autoDoes')}</h3>
          <Select
            value={step.auto?.action ?? 'message'}
            onChange={(e) =>
              set({ auto: { ...step.auto, action: e.target.value as (typeof AUTO_ACTIONS)[number] } })
            }
          >
            {AUTO_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`fms.auto.${a}`)}
              </option>
            ))}
          </Select>
          {(step.auto?.action ?? 'message') === 'message' && (
            <Textarea
              className="font-sans"
              rows={2}
              placeholder={t('fms.b.messagePh')}
              value={step.auto?.text ?? ''}
              onChange={(e) => set({ auto: { action: 'message', text: e.target.value } })}
            />
          )}
          {step.auto?.action === 'document' && (
            <Select
              value={step.auto.documentType ?? ''}
              onChange={(e) => set({ auto: { action: 'document', documentType: e.target.value } })}
            >
              <option value="">{t('org.choose')}</option>
              {docTypes.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
          {step.auto?.action === 'stock' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select
                aria-label={t('fms.b.stockWay')}
                value={step.auto.direction ?? 'OUT'}
                onChange={(e) => set({ auto: { ...step.auto!, direction: e.target.value as 'IN' | 'OUT' } })}
              >
                <option value="OUT">{t('fms.b.stockOut')}</option>
                <option value="IN">{t('fms.b.stockIn')}</option>
              </Select>
              <Select
                aria-label={t('fms.b.stockLines')}
                value={step.auto.itemsField ?? ''}
                onChange={(e) => set({ auto: { ...step.auto!, itemsField: e.target.value || undefined } })}
              >
                <option value="">
                  {itemFields.length ? t('fms.b.stockFirstLines') : t('fms.b.stockNoLines')}
                </option>
                {itemFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t('fms.b.stockHint')}</p>
            </div>
          )}
          {step.auto?.action === 'webhook' && (
            <Input
              placeholder="https://…"
              value={step.auto.url ?? ''}
              onChange={(e) => set({ auto: { action: 'webhook', url: e.target.value } })}
            />
          )}
        </section>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('fms.b.checklist')}</h3>
            <Textarea
              className="font-sans"
              rows={3}
              placeholder={t('fms.b.checklistPh')}
              defaultValue={step.checklist.join('\n')}
              onBlur={(e) =>
                set({
                  checklist: e.target.value
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('fms.b.form')}</h3>
            <FieldsEditor fields={step.fields} onChange={(fields) => set({ fields })} />
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('fms.b.documents')}</h3>
            <div className="flex flex-wrap gap-1.5">
              {docTypes.map((d) => (
                <button
                  key={d.code}
                  type="button"
                  aria-pressed={step.documents.includes(d.code)}
                  onClick={() =>
                    set({
                      documents: step.documents.includes(d.code)
                        ? step.documents.filter((x) => x !== d.code)
                        : [...step.documents, d.code],
                    })
                  }
                  className={cn(
                    'h-8 rounded-pill border px-3 text-xs',
                    step.documents.includes(d.code)
                      ? 'border-primary bg-primary/15 font-semibold'
                      : 'bg-card',
                  )}
                >
                  {d.name}
                </button>
              ))}
              {!docTypes.length && <p className="text-xs text-muted-foreground">{t('fms.b.noDocTypes')}</p>}
            </div>
          </section>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={step.proofRequired}
              onChange={(e) => set({ proofRequired: e.target.checked })}
            />
            {t('fms.b.proof')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={step.notifyCustomer}
              onChange={(e) => set({ notifyCustomer: e.target.checked })}
            />
            {t('fms.b.notifyCustomer')}
          </label>
        </>
      )}
    </div>
  );
}
