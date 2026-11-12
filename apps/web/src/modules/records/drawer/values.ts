import { REFS_KEY, refsOf, type FlowField, type RecordDefinition } from '@mono/shared';
import type { Uploaded } from '@/lib/upload';
import { isoToLocalInput } from '@/lib/when';
import { toPayload, type Values } from '@/modules/fms/payload';
import type { RecordFile } from '../api';

const FILES = ['photo', 'file', 'signature'];

/** Saved values → what the form inputs hold: date-times in the company's clock, file ids as uploaded files. */
export function toFormValues(fields: FlowField[], data: Values, files: RecordFile[], tz: string): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = data[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === 'datetime' && typeof v === 'string') out[f.key] = isoToLocalInput(v, tz);
    else if (FILES.includes(f.type))
      out[f.key] = (Array.isArray(v) ? v : [v]).flatMap((id): Uploaded[] => {
        const file = files.find((x) => x.id === id);
        return file
          ? [{ id: file.id, url: file.url, mime: file.mime, size: file.size, name: file.name }]
          : [];
      });
    else out[f.key] = v;
  }
  const refs = Object.fromEntries(Object.entries(refsOf(data)).filter(([k]) => k in out));
  if (Object.keys(refs).length) out[REFS_KEY] = refs;
  return out;
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
export const lineFilled = (fields: FlowField[], row: Values) => fields.some((f) => filled(row[f.key]));

export type LineRows = Record<string, Values[]>;

/** What is sent to the API: the fields and every table's lines (empty lines dropped). */
export function toRecordBody(def: RecordDefinition, values: Values, lines: LineRows, tz: string) {
  return {
    data: toPayload(def.fields, values, tz),
    lines: Object.fromEntries(
      def.tables.map((t) => [
        t.key,
        (lines[t.key] ?? []).filter((r) => lineFilled(t.fields, r)).map((r) => toPayload(t.fields, r, tz)),
      ]),
    ),
  };
}
