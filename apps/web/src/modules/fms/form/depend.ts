import { refsOf, withRef, type FlowField } from '@mono/shared';
import type { Values } from '../payload';

export const filled = (v: unknown) => !(v === undefined || v === null || v === '');
const text = (v: unknown) => (filled(v) && typeof v !== 'object' ? String(v).trim().toLowerCase() : '');

/** Is this field filled by another field of the form and closed to typing? */
export const isLockedTarget = (field: FlowField, fields: FlowField[]) =>
  Boolean(field.locked) && fields.some((f) => f.key !== field.key && f.fill && field.key in f.fill);

/** The field keys another field fills that people can't change by hand. */
export const lockedTargetsOf = (field: FlowField, fields: FlowField[]) =>
  Object.keys(field.fill ?? {}).filter((k) => fields.find((f) => f.key === k && f.key !== field.key)?.locked);

/**
 * Dependent choices (`filterBy`): when the field a choice depends on changes, the choice made under the old value
 * is emptied (and so on down a chain: outlet → table → seat). A choice set in the same change — an auto-fill that
 * brings both — is kept.
 */
export function clearDependents(fields: FlowField[], prev: Values, next: Values): Values {
  let out = next;
  for (let pass = 0; pass < fields.length; pass++) {
    let changed = false;
    for (const f of fields) {
      const parent = f.filterBy?.field;
      if (!parent || !fields.some((p) => p.key === parent) || !filled(out[f.key])) continue;
      const moved = text(prev[parent]) !== text(out[parent]) || refsOf(prev)[parent] !== refsOf(out)[parent];
      if (!moved || out[f.key] !== prev[f.key]) continue;
      const { [f.key]: _gone, ...rest } = out;
      out = withRef(rest, f.key, null);
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}

/** The same test the server makes (`matchesFilter`): the row's column against the other field's value or link. */
export function fitsParent(
  columns: Record<string, unknown> | undefined,
  column: string,
  parent: { value?: string; ref?: string },
) {
  const link = refsOf(columns)[column];
  if (link && parent.ref && link.split(':')[0] === parent.ref.split(':')[0]) return link === parent.ref;
  return text(columns?.[column]) === text(parent.value);
}
