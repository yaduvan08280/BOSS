import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FIELD_TYPES, type FlowField } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { keyFor } from './keys';

/** Edit a form: label, type, required, choices, help. Keys come from the label and never change after. */
export function FieldsEditor({
  fields,
  onChange,
}: {
  fields: FlowField[];
  onChange: (f: FlowField[]) => void;
}) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<FlowField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, by: number) => {
    const next = [...fields];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={f.key} className="space-y-2 rounded-control border bg-card p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_170px_auto]">
            <Input
              aria-label={t('fms.b.fieldLabel')}
              placeholder={t('fms.b.fieldLabel')}
              value={f.label}
              onChange={(e) => set(i, { label: e.target.value })}
            />
            <Select
              aria-label={t('fms.b.fieldType')}
              value={f.type}
              onChange={(e) => set(i, { type: e.target.value as FlowField['type'] })}
            >
              {FIELD_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`fms.ft.${ty}`)}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1">
              <label className="mr-2 flex items-center gap-1.5 text-xs">
                <Checkbox checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} />
                {t('fms.b.required')}
              </label>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={i === 0}
                aria-label={t('chk.up')}
                onClick={() => move(i, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={i === fields.length - 1}
                aria-label={t('chk.down')}
                onClick={() => move(i, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('common.remove')}
                onClick={() => onChange(fields.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          {(f.type === 'dropdown' || f.type === 'multiselect') && (
            <Input
              aria-label={t('fms.b.options')}
              placeholder={t('fms.b.optionsPh')}
              defaultValue={(f.options ?? []).join(', ')}
              onBlur={(e) =>
                set(i, {
                  options: e.target.value
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
          )}
          {f.type === 'master' && (
            <Select
              aria-label={t('fms.b.master')}
              value={f.master ?? 'customers'}
              onChange={(e) => set(i, { master: e.target.value })}
            >
              {['customers', 'items', 'vendors', 'people'].map((m) => (
                <option key={m} value={m}>
                  {t(`fms.master.${m}`)}
                </option>
              ))}
            </Select>
          )}
          <Input
            aria-label={t('fms.b.help')}
            placeholder={t('fms.b.help')}
            value={f.help ?? ''}
            onChange={(e) => set(i, { help: e.target.value || undefined })}
          />
        </div>
      ))}
      <Button
        size="sm"
        onClick={() => {
          const label = t('fms.b.newField', { n: fields.length + 1 });
          onChange([
            ...fields,
            {
              key: keyFor(
                label,
                fields.map((f) => f.key),
              ),
              label,
              type: 'text',
              required: false,
            },
          ]);
        }}
      >
        <Plus /> {t('fms.b.addField')}
      </Button>
    </div>
  );
}
