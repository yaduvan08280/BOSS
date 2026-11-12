import type { FlowField } from '@mono/shared';
import type { FormOwner } from '../form/ctx';

/** One block of extra settings for a field in the form editor. `fields` are all fields of the same form. */
export type ExtrasProps = {
  field: FlowField;
  fields: FlowField[];
  onChange: (patch: Partial<FlowField>) => void;
  /** The flow / master / record type being edited, when it is already saved. */
  owner?: FormOwner;
};
