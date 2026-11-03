import type { FlowField } from '@mono/shared';
import type { Uploaded } from '@/lib/upload';
import { localInputToIso } from '@/lib/when';

export type Values = Record<string, unknown>;

/** Before sending: dates-with-time to real instants in the company time zone, file lists to ids. */
export function toPayload(fields: FlowField[], values: Values, tz: string): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined || v === '') continue;
    if (f.type === 'datetime' && typeof v === 'string') out[f.key] = localInputToIso(v, tz);
    else if (['photo', 'file', 'signature'].includes(f.type) && Array.isArray(v))
      out[f.key] = (v as Uploaded[]).map((u) => u.id);
    else out[f.key] = v;
  }
  return out;
}
