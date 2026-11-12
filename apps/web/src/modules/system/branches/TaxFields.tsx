import { useTranslation } from 'react-i18next';
import { TAX_REGIMES, type TaxProfile } from '@mono/shared';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

/** An entity's tax profile, filled by the accountant: the regime, what the tax number is called, legal lines. */
export function TaxFields({
  value,
  onChange,
}: {
  value: TaxProfile | undefined;
  onChange: (v: TaxProfile | undefined) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<TaxProfile>) =>
    onChange({ regime: value?.regime ?? 'GST', ...value, ...patch });
  return (
    <div className="space-y-3 rounded-control border p-3">
      <Field label={t('taxProfile.regime')} hint={t('taxProfile.hint')}>
        <Select
          value={value?.regime ?? ''}
          onChange={(e) =>
            onChange(
              e.target.value ? { ...value, regime: e.target.value as TaxProfile['regime'] } : undefined,
            )
          }
        >
          <option value="">{t('taxProfile.unset')}</option>
          {TAX_REGIMES.map((r) => (
            <option key={r} value={r}>
              {t(`taxProfile.r.${r}`)}
            </option>
          ))}
        </Select>
      </Field>
      {value && value.regime !== 'NONE' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('taxProfile.idLabel')} className="col-span-2 sm:col-span-1">
            <Input
              value={value.idLabel ?? ''}
              placeholder="GSTIN / TRN"
              onChange={(e) => set({ idLabel: e.target.value || null })}
            />
          </Field>
          <Field label={t('taxProfile.invoiceTitle')} className="col-span-2 sm:col-span-1">
            <Input
              value={value.invoiceTitle ?? ''}
              placeholder="Tax Invoice"
              onChange={(e) => set({ invoiceTitle: e.target.value || null })}
            />
          </Field>
          <Field label={t('taxProfile.note')} className="col-span-2">
            <Input value={value.note ?? ''} onChange={(e) => set({ note: e.target.value || null })} />
          </Field>
        </div>
      )}
    </div>
  );
}
