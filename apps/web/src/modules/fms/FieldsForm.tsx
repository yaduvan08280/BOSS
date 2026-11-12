import { LocateFixed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { refsOf, withRef, type FlowField, type OrgPerson } from '@mono/shared';
import { DateInput, DateTimeInput } from '@/components/ui/date-input';
import { FileDrop } from '@/components/file-drop';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { Uploaded } from '@/lib/upload';
import { cn } from '@/lib/utils';
import type { FormCtx, FormOwner } from './form/ctx';
import { clearDependents, isLockedTarget } from './form/depend';
import { FormulaValue } from './form/FormulaValue';
import { ItemLines } from './form/ItemLines';
import { LearnInput } from './form/LearnInput';
import { LinkedInput } from './form/LinkedInput';
import { LockedValue } from './form/LockedValue';
import { SignaturePad } from './form/SignaturePad';
import type { Values } from './payload';

/** Every field type of §6.1, as one form. Used for start forms, step forms and the public form. */
export function FieldsForm({
  fields,
  values,
  onChange,
  errors = {},
  people = [],
  publicForm = false,
  owner,
  known = {},
}: {
  fields: FlowField[];
  values: Values;
  onChange: (v: Values) => void;
  errors?: Record<string, string>;
  people?: OrgPerson[];
  publicForm?: boolean;
  /** Where this form lives: needed by value lists and linked choices. */
  owner?: FormOwner;
  /** Values already on the record (the start form and earlier steps). */
  known?: Values;
}) {
  const ctx: FormCtx = {
    fields,
    values,
    refs: refsOf(values),
    // A typed value has no link; a picked one carries its row's.
    set: (k, v, ref) => onChange(clearDependents(fields, values, withRef({ ...values, [k]: v }, k, ref))),
    patch: (vs, refs = {}) =>
      onChange(
        clearDependents(
          fields,
          values,
          Object.entries(refs).reduce((d, [k, r]) => withRef(d, k, r), { ...values, ...vs }),
        ),
      ),
    owner,
    known,
    publicForm,
    people,
  };
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f) => (
        <Field
          key={f.key}
          label={`${f.label}${f.required && f.type !== 'formula' ? ' *' : ''}`}
          hint={f.help}
          error={errors[f.key]}
          className={cn(
            ['longtext', 'items', 'photo', 'file', 'signature', 'multiselect'].includes(f.type) &&
              'sm:col-span-2',
          )}
        >
          {isLockedTarget(f, fields) ? (
            <LockedValue field={f} value={values[f.key]} />
          ) : (
            <FieldInput field={f} value={values[f.key]} ctx={ctx} />
          )}
        </Field>
      ))}
    </div>
  );
}

function FieldInput({ field: f, value, ctx }: { field: FlowField; value: unknown; ctx: FormCtx }) {
  const { t } = useTranslation();
  const { publicForm } = ctx;
  const onChange = (v: unknown) => ctx.set(f.key, v);
  const str = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  switch (f.type) {
    case 'longtext':
      return (
        <Textarea className="font-sans" rows={3} value={str} onChange={(e) => onChange(e.target.value)} />
      );
    case 'number':
    case 'amount':
      return (
        <Input
          inputMode="decimal"
          value={str}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.type === 'amount' ? '₹' : ''}
        />
      );
    case 'date':
      return <DateInput value={str} onChange={onChange} />;
    case 'datetime':
      return <DateTimeInput value={str} onChange={onChange} />;
    case 'yesno':
      return (
        <div className="flex gap-2">
          {[true, false].map((b) => (
            <button
              key={String(b)}
              type="button"
              aria-pressed={value === b}
              onClick={() => onChange(b)}
              className={cn(
                'h-10 flex-1 rounded-control border text-sm font-medium',
                value === b ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
              )}
            >
              {b ? t('fms.yes') : t('fms.no')}
            </button>
          ))}
        </div>
      );
    case 'dropdown':
      return (
        <Select value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('org.choose')}</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case 'multiselect': {
      const picked = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {(f.options ?? []).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={picked.includes(o)}
              onClick={() => onChange(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o])}
              className={cn(
                'h-9 rounded-pill border px-3 text-sm',
                picked.includes(o) ? 'border-primary bg-primary/15 font-medium' : 'bg-card',
              )}
            >
              {o}
            </button>
          ))}
        </div>
      );
    }
    case 'photo':
    case 'file':
      if (publicForm) return <p className="text-xs text-muted-foreground">{t('fms.filesInApp')}</p>;
      return <FileDrop files={Array.isArray(value) ? (value as Uploaded[]) : []} onChange={onChange} />;
    case 'signature':
      return publicForm ? (
        <p className="text-xs text-muted-foreground">{t('fms.filesInApp')}</p>
      ) : (
        <SignaturePad value={value as Uploaded[] | undefined} onChange={onChange} />
      );
    case 'items':
      return <ItemLines field={f} value={value} ctx={ctx} />;
    case 'formula':
      return <FormulaValue field={f} value={value} ctx={ctx} />;
    case 'master':
      // Any master (customers, items, vendors, people, your own): search and pick; the public form just types.
      if (!publicForm) return <LinkedInput field={f} value={value} ctx={ctx} />;
      return <Input value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'location':
      return (
        <div className="flex gap-2">
          <Input value={str} onChange={(e) => onChange(e.target.value)} placeholder={t('fms.locationPh')} />
          <Button
            type="button"
            size="icon"
            aria-label={t('fms.myLocation')}
            onClick={() =>
              navigator.geolocation?.getCurrentPosition((p) =>
                onChange(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`),
              )
            }
          >
            <LocateFixed />
          </Button>
        </div>
      );
    case 'mobile':
      return (
        <Input
          inputMode="tel"
          value={str}
          onChange={(e) => onChange(e.target.value)}
          placeholder="98xxxxxxxx"
        />
      );
    case 'email':
      return <Input type="email" inputMode="email" value={str} onChange={(e) => onChange(e.target.value)} />;
    default:
      if (f.learn && !publicForm) return <LearnInput field={f} value={value} ctx={ctx} />;
      return <Input value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}
