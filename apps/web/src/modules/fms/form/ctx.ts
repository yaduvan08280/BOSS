import type { FlowField, OrgPerson, Refs } from '@mono/shared';
import type { Values } from '../payload';

/** Where a form lives (a flow, a master, a record type): value lists and choices are asked for per owner. */
export type FormOwner = {
  kind: 'flow' | 'master' | 'recordType';
  id: string;
  /** A flow's step form: the step, and the record being filled (it keeps the version it started on). */
  step?: string;
  record?: string;
};

/** What every field input can reach: the whole form, not only its own value (auto-fill, dependent choices, formulas). */
export type FormCtx = {
  fields: FlowField[];
  values: Values;
  /** Links of picked rows by field key (`customer:<id>`, `item:<id>`, `rec:<id>` …). */
  refs: Refs;
  /** Set one field. Pass `ref` when the value was picked from a row; leave it out when it was typed. */
  set: (key: string, value: unknown, ref?: string | null) => void;
  /** Set several fields at once (auto-fill). `refs` may carry a link, or null to drop one, per field. */
  patch: (values: Values, refs?: Record<string, string | null>) => void;
  owner?: FormOwner;
  /** Values already on the record (the start form and earlier steps). */
  known: Values;
  publicForm: boolean;
  people: OrgPerson[];
};

export type InputProps = { field: FlowField; value: unknown; ctx: FormCtx };
