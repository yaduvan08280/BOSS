import { useTranslation } from 'react-i18next';
import type { FlowStep, StepStock } from '@mono/shared';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

type FieldRef = { key: string; label: string; type: string };
type Place = NonNullable<StepStock['from']>;
const PLACE_TYPES = ['text', 'dropdown', 'master', 'location'];

/** One end of a move: not recorded, a fixed place, or the value of a form field. */
function PlaceInput({
  label,
  value,
  fields,
  noneLabel,
  onChange,
}: {
  label: string;
  value: Place | undefined;
  fields: FieldRef[];
  noneLabel: string;
  onChange: (p: Place | undefined) => void;
}) {
  const { t } = useTranslation();
  const mode = value?.field ? `f:${value.field}` : value?.fixed !== undefined ? 'fixed' : '';
  return (
    <Field label={label}>
      <div className="space-y-1.5">
        <Select
          aria-label={label}
          value={mode}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? undefined : v === 'fixed' ? { fixed: '' } : { field: v.slice(2) });
          }}
        >
          <option value="">{noneLabel}</option>
          <option value="fixed">{t('stockSteps.editor.placeFixed')}</option>
          {fields.map((f) => (
            <option key={f.key} value={`f:${f.key}`}>
              {t('stockSteps.editor.placeField', { label: f.label })}
            </option>
          ))}
        </Select>
        {mode === 'fixed' && (
          <Input
            aria-label={`${label} — ${t('stockSteps.editor.placeFixed')}`}
            placeholder={t('stockSteps.editor.placePh')}
            value={value?.fixed ?? ''}
            maxLength={80}
            onChange={(e) => onChange({ fixed: e.target.value })}
          />
        )}
      </div>
    </Field>
  );
}

/**
 * The Stock part of a step (L15, L16): what it does to stock when it is done, which item lines, from / to where,
 * and what happens when there is not enough. For every step type but AUTO (which has its own "stock" action).
 */
export function StepStockEditor({
  step,
  fields,
  onChange,
}: {
  step: FlowStep;
  /** Every field of the flow. */
  fields: FieldRef[];
  onChange: (stock: StepStock | undefined) => void;
}) {
  const { t } = useTranslation();
  const s = step.stock;
  const itemFields = fields.filter((f) => f.type === 'items');
  const places = fields.filter((f) => PLACE_TYPES.includes(f.type));
  const set = (patch: Partial<StepStock>) => s && onChange({ ...s, ...patch });
  const needsTo = s?.action === 'TRANSFER' && !s.to?.field && !s.to?.fixed?.trim();
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('stockSteps.editor.title')}</h3>
      <Select
        aria-label={t('stockSteps.editor.title')}
        value={s?.action ?? ''}
        onChange={(e) => {
          const action = e.target.value as StepStock['action'] | '';
          onChange(action ? { short: 'block', ...s, action } : undefined);
        }}
      >
        <option value="">{t('stockSteps.editor.none')}</option>
        {(['ISSUE', 'RECEIVE', 'TRANSFER'] as const).map((a) => (
          <option key={a} value={a}>
            {t(`stockSteps.editor.action.${a}`)}
          </option>
        ))}
      </Select>
      {s && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('stockSteps.editor.lines')} className="sm:col-span-2">
            <Select
              aria-label={t('stockSteps.editor.lines')}
              value={s.itemsField ?? ''}
              onChange={(e) => set({ itemsField: e.target.value || undefined })}
            >
              <option value="">
                {itemFields.length ? t('stockSteps.editor.firstLines') : t('stockSteps.editor.noLines')}
              </option>
              {itemFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <PlaceInput
            label={t('stockSteps.editor.from')}
            value={s.from}
            fields={places}
            noneLabel={t(`stockSteps.editor.${s.action === 'TRANSFER' ? 'placeOwn' : 'placeNone'}`)}
            onChange={(from) => set({ from })}
          />
          <PlaceInput
            label={t('stockSteps.editor.to')}
            value={s.to}
            fields={places}
            noneLabel={t('stockSteps.editor.placeNone')}
            onChange={(to) => set({ to })}
          />
          {needsTo && (
            <p className="text-xs text-status-bad-fg sm:col-span-2">{t('stockSteps.editor.needsTo')}</p>
          )}
          {s.action === 'ISSUE' && (
            <Field label={t('stockSteps.editor.short')} className="sm:col-span-2">
              <Select
                aria-label={t('stockSteps.editor.short')}
                value={s.short}
                onChange={(e) => set({ short: e.target.value as StepStock['short'] })}
              >
                <option value="block">{t('stockSteps.editor.shortBlock')}</option>
                <option value="flag">{t('stockSteps.editor.shortFlag')}</option>
              </Select>
            </Field>
          )}
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('stockSteps.editor.hint')}</p>
        </div>
      )}
    </section>
  );
}
