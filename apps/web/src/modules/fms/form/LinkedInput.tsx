import { useTranslation } from 'react-i18next';
import { makeRef, parseRef, parseSource, refsOf, type FlowField } from '@mono/shared';
import { Select } from '@/components/ui/form';
import { personLabel } from '@/lib/people';
import { isoToLocalInput } from '@/lib/when';
import { useMe } from '@/modules/auth/session';
import type { MasterOption } from '@/modules/masters/api';
import { MasterPicker } from '@/modules/masters/MasterPicker';
import type { Values } from '../payload';
import type { InputProps } from './ctx';
import { filled, fitsParent, lockedTargetsOf } from './depend';

/** A row's column as the target field's input holds it. */
function asInput(target: FlowField, raw: unknown, tz: string): unknown {
  if (!filled(raw) || ['photo', 'file', 'signature'].includes(target.type)) return undefined;
  if (target.type === 'datetime')
    return typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? isoToLocalInput(raw, tz) : undefined;
  if (target.type === 'mobile') return String(raw).replace(/^\+91/, '');
  if (target.type === 'items')
    return Array.isArray(raw)
      ? (raw as Record<string, unknown>[]).map((l) => ({
          ...l,
          qty: String(l.qty ?? ''),
          rate: String(l.rate ?? ''),
        }))
      : undefined;
  return typeof raw === 'object' && !Array.isArray(raw) ? undefined : raw;
}

/**
 * A "from a master" field (§2.2–2.3): search and pick a row of a master, a value or a whole record of another
 * flow; the pick keeps its link, fills other fields (`fill`) and can depend on another field (`filterBy`).
 */
export function LinkedInput({ field, value, ctx }: InputProps) {
  const { t } = useTranslation();
  const tz = useMe().data?.company.timezone ?? 'Asia/Kolkata';
  const source = field.master ?? 'customers';
  const text = typeof value === 'string' ? value : filled(value) ? String(value) : '';

  /** Typed or cleared: no link, and what only this field's row could fill is emptied. */
  const typed = (v: string) => {
    const locked = lockedTargetsOf(field, ctx.fields);
    if (!locked.length) return ctx.set(field.key, v);
    ctx.patch(
      { [field.key]: v, ...Object.fromEntries(locked.map((k) => [k, undefined])) },
      { [field.key]: null, ...Object.fromEntries(locked.map((k) => [k, null])) },
    );
  };
  /** Picked: keep the link, and copy the row's columns into the fields this one fills. */
  const pick = (o: MasterOption) => {
    const values: Values = { [field.key]: o.value };
    const refs: Record<string, string | null> = { [field.key]: o.ref ?? null };
    for (const [key, column] of Object.entries(field.fill ?? {})) {
      const target = ctx.fields.find((f) => f.key === key);
      if (!target || key === field.key) continue;
      values[key] = asInput(target, o.columns?.[column], tz);
      refs[key] = (target.type === 'master' && filled(values[key]) && refsOf(o.columns)[column]) || null;
    }
    ctx.patch(values, refs);
  };

  if (source === 'people') {
    // People are few and already loaded: a plain dropdown, which now keeps the person's link too.
    const active = ctx.people.filter((p) => p.status === 'ACTIVE');
    const linked = parseRef(ctx.refs[field.key]);
    const current = active.find((p) => (linked?.kind === 'user' ? p.id === linked.id : p.name === text));
    return (
      <Select
        aria-label={field.label}
        value={current?.id ?? ''}
        onChange={(e) => {
          const p = active.find((x) => x.id === e.target.value);
          if (!p) return typed('');
          pick({
            value: p.name,
            label: p.name,
            sub: null,
            ref: makeRef('user', p.id),
            columns: {
              name: p.name,
              code: p.code,
              mobile: p.mobile,
              designation: p.designationName,
              department: p.mainDepartmentName ?? null,
            },
          });
        }}
      >
        <option value="">{t('org.choose')}</option>
        {active.map((p) => (
          <option key={p.id} value={p.id}>
            {personLabel(p)}
          </option>
        ))}
      </Select>
    );
  }

  // Dependent choices: the other field's value, from this form or — when it is not on it — from the record.
  const dep = field.filterBy;
  const parentField = dep && ctx.fields.find((f) => f.key === dep.field);
  const from = parentField ? ctx.values : ctx.known;
  const parentValue = dep && filled(from[dep.field]) ? String(from[dep.field]) : undefined;
  const parent = dep
    ? { value: parentValue, ref: (parentField ? ctx.refs : refsOf(ctx.known))[dep.field] }
    : undefined;
  const waiting = Boolean(dep) && !parentValue;
  const { owner } = ctx;
  return (
    <div className="space-y-1">
      <MasterPicker
        source={source}
        at={
          owner
            ? { owner: `${owner.kind}:${owner.id}`, field: field.key, step: owner.step, record: owner.record }
            : null
        }
        parent={parent}
        narrow={!owner && dep && parent ? (o) => fitsParent(o.columns, dep.column, parent) : undefined}
        value={text}
        label={field.label}
        onChange={typed}
        onPick={pick}
        allowTyped={parseSource(source)?.kind === 'fms'}
        disabled={waiting}
        placeholder={
          waiting ? t('links.chooseFirst', { field: parentField?.label ?? dep?.field }) : undefined
        }
      />
      {waiting && (
        <p className="text-xs text-muted-foreground">
          {t('links.chooseFirstHint', { field: parentField?.label ?? dep?.field })}
        </p>
      )}
    </div>
  );
}
