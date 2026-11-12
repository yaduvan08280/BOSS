import type { InputProps } from './ctx';

/** A formula field (§2.3): read-only, worked out from the other fields as they change. */
export function FormulaValue({ value }: InputProps) {
  return (
    <output className="tabular flex h-10 items-center rounded-control border bg-muted px-3 text-sm">
      {value === undefined || value === null || value === '' ? '—' : String(value)}
    </output>
  );
}
