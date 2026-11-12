import { MasterPicker } from '@/modules/masters/MasterPicker';
import type { InputProps } from './ctx';

/**
 * A "from a master" field (§2.2–2.3): search and pick a row of a master, a value or a whole record of another
 * flow; the pick keeps its link, fills other fields (`fill`) and can depend on another field (`filterBy`).
 */
export function LinkedInput({ field, value, ctx }: InputProps) {
  return (
    <MasterPicker
      source={field.master ?? 'customers'}
      value={typeof value === 'string' ? value : ''}
      onChange={(v) => ctx.set(field.key, v)}
      label={field.label}
    />
  );
}
