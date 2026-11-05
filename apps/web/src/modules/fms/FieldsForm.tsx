import { Eraser, LocateFixed, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlowField, OrgPerson } from '@mono/shared';
import { DateInput, DateTimeInput } from '@/components/ui/date-input';
import { FileDrop } from '@/components/file-drop';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { personLabel } from '@/lib/people';
import { uploadFile, type Uploaded } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { MasterPicker } from '@/modules/masters/MasterPicker';

import type { Values } from './payload';
type Line = { item: string; qty: string; rate: string };

/** Every field type of §6.1, as one form. Used for start forms, step forms and the public form. */
export function FieldsForm({
  fields,
  values,
  onChange,
  errors = {},
  people = [],
  publicForm = false,
}: {
  fields: FlowField[];
  values: Values;
  onChange: (v: Values) => void;
  errors?: Record<string, string>;
  people?: OrgPerson[];
  publicForm?: boolean;
}) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f) => (
        <Field
          key={f.key}
          label={`${f.label}${f.required ? ' *' : ''}`}
          hint={f.help}
          error={errors[f.key]}
          className={cn(
            ['longtext', 'items', 'photo', 'file', 'signature', 'multiselect'].includes(f.type) &&
              'sm:col-span-2',
          )}
        >
          <FieldInput
            field={f}
            value={values[f.key]}
            onChange={(v) => set(f.key, v)}
            people={people}
            publicForm={publicForm}
          />
        </Field>
      ))}
    </div>
  );
}

function FieldInput({
  field: f,
  value,
  onChange,
  people,
  publicForm,
}: {
  field: FlowField;
  value: unknown;
  onChange: (v: unknown) => void;
  people: OrgPerson[];
  publicForm: boolean;
}) {
  const { t } = useTranslation();
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
      return <ItemLines value={Array.isArray(value) ? (value as Line[]) : []} onChange={onChange} />;
    case 'master':
      if (f.master === 'people' && !publicForm)
        return (
          <Select value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">{t('org.choose')}</option>
            {people
              .filter((p) => p.status === 'ACTIVE')
              .map((p) => (
                <option key={p.id} value={p.name}>
                  {personLabel(p)}
                </option>
              ))}
          </Select>
        );
      // Any master (customers, items, vendors, your own): search and pick; the public form just types.
      if (!publicForm)
        return (
          <MasterPicker source={f.master ?? 'customers'} value={str} onChange={onChange} label={f.label} />
        );
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
      return <Input value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Item lines: item, quantity, rate; the amount is worked out. */
function ItemLines({ value, onChange }: { value: Line[]; onChange: (v: Line[]) => void }) {
  const { t } = useTranslation();
  const lines = value.length ? value : [{ item: '', qty: '', rate: '' }];
  const set = (i: number, patch: Partial<Line>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const amount = (l: Line) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
  const total = lines.reduce((a, l) => a + amount(l), 0);
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_70px_90px_auto] items-center gap-1.5 sm:grid-cols-[1fr_90px_110px_110px_auto]"
        >
          <Input
            aria-label={t('fms.item')}
            placeholder={t('fms.item')}
            value={l.item}
            onChange={(e) => set(i, { item: e.target.value })}
          />
          <Input
            aria-label={t('fms.qty')}
            placeholder={t('fms.qty')}
            inputMode="decimal"
            value={l.qty}
            onChange={(e) => set(i, { qty: e.target.value })}
          />
          <Input
            aria-label={t('fms.rate')}
            placeholder={t('fms.rate')}
            inputMode="decimal"
            value={l.rate}
            onChange={(e) => set(i, { rate: e.target.value })}
          />
          <span className="tabular hidden text-right text-sm sm:block">
            ₹{amount(l).toLocaleString('en-IN')}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t('common.remove')}
            onClick={() => onChange(lines.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange([...lines, { item: '', qty: '', rate: '' }])}
        >
          <Plus /> {t('fms.addLine')}
        </Button>
        <span className="tabular text-sm font-semibold">
          {t('fms.total')}: ₹{total.toLocaleString('en-IN')}
        </span>
      </div>
    </div>
  );
}

/** Draw with a finger or mouse; saved as an image. */
function SignaturePad({ value, onChange }: { value?: Uploaded[]; onChange: (v: Uploaded[]) => void }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * canvas.current!.width) / r.width,
      ((e.clientY - r.top) * canvas.current!.height) / r.height,
    ] as const;
  };
  const save = () =>
    canvas.current!.toBlob(async (blob) => {
      if (!blob) return;
      setBusy(true);
      try {
        onChange([await uploadFile(blob, `signature-${Date.now()}.png`)]);
      } finally {
        setBusy(false);
      }
    }, 'image/png');
  if (value?.length)
    return (
      <div className="flex items-center gap-3">
        <img src={value[0]!.url} alt={t('fms.signature')} className="h-16 rounded-control border bg-white" />
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
          <Eraser /> {t('fms.signAgain')}
        </Button>
      </div>
    );
  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        width={600}
        height={160}
        aria-label={t('fms.signHere')}
        className="h-32 w-full touch-none rounded-control border bg-white"
        onPointerDown={(e) => {
          const ctx = canvas.current!.getContext('2d')!;
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(...pos(e));
          setDrawing(true);
        }}
        onPointerMove={(e) => {
          if (!drawing) return;
          const ctx = canvas.current!.getContext('2d')!;
          ctx.lineTo(...pos(e));
          ctx.stroke();
        }}
        onPointerUp={() => setDrawing(false)}
      />
      <Button type="button" size="sm" disabled={busy} onClick={save}>
        {t('fms.saveSignature')}
      </Button>
    </div>
  );
}
