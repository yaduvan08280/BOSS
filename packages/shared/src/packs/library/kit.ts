import { ME, type PackInput } from '../schema';

/** Small builders so a pack reads as a list of what a trade needs. */
type Field = Record<string, unknown>;
export const f = (key: string, label: string, type = 'text', more: Field = {}): Field => ({
  key,
  label,
  type,
  ...more,
});
/** A required field that reports can use. */
export const req = (key: string, label: string, type = 'text', more: Field = {}): Field =>
  f(key, label, type, { required: true, reportable: true, ...more });
/** A field reports can use. */
export const rep = (key: string, label: string, type = 'text', more: Field = {}): Field =>
  f(key, label, type, { reportable: true, ...more });
export const pick = (key: string, label: string, options: string[], more: Field = {}): Field =>
  f(key, label, 'dropdown', { options, reportable: true, ...more });
export const st = (key: string, label: string, kind: string, final = false, frees = false) => ({
  key,
  label,
  kind,
  ...(final ? { final } : {}),
  ...(frees ? { frees } : {}),
});
export const move = (
  from: string,
  action: string,
  label: string,
  to: string,
  who: string[] = ['edit', 'creator'],
) => ({
  from,
  action,
  label,
  to,
  who,
});
type RecordType = NonNullable<PackInput['recordTypes']>[number];
export const rt = (
  key: string,
  name: string,
  pluralName: string,
  prefix: string,
  icon: string,
  def: { fields: Field[]; tables?: object[]; statuses: object[]; moves: object[] },
): RecordType => ({
  key,
  name,
  pluralName,
  prefix,
  icon,
  definition: {
    fields: def.fields,
    tables: def.tables ?? [],
    statuses: def.statuses,
    start: (def.statuses[0] as { key: string }).key,
    moves: def.moves,
  },
});
/** A step someone does, due some hours after the one before; whoever installs the pack does it until people are chosen. */
export const task = (key: string, name: string, hours: number, more: Field = {}) => ({
  key,
  name,
  type: 'TASK',
  doerIds: [ME],
  time: { value: hours, unit: 'hours', anchor: 'previous' },
  ...more,
});
type Flow = NonNullable<PackInput['flows']>[number];
export const flow = (
  key: string,
  name: string,
  runName: string,
  startFields: Field[],
  steps: object[],
  description = '',
): Flow => ({
  key,
  name,
  runName,
  description,
  definition: { timeModel: 'calendar', startFields, steps },
});
type Report = NonNullable<PackInput['reports']>[number];
/** A saved report over a pack's record type: a count (or a total of a number field) for each value of a field. */
export const byField = (key: string, name: string, rtKey: string, field: string, total?: string): Report => ({
  key,
  name,
  definition: {
    source: { kind: 'recordType', id: `@pack/rt/${rtKey}` },
    columns: [],
    filters: [],
    groupBy: { field },
    measures: total ? [{ fn: 'sum', field: total }] : [{ fn: 'count' }],
    look: 'table',
  },
});
/** A register: the plain list of a record type's records, newest first, with a filter when one is given. */
export const register = (
  key: string,
  name: string,
  rtKey: string,
  columns: string[],
  filters: object[] = [],
): Report => ({
  key,
  name,
  definition: {
    source: { kind: 'recordType', id: `@pack/rt/${rtKey}` },
    columns,
    filters,
    measures: [],
    look: 'table',
  },
});
const view = (...m: string[]) => m.map((x) => `${x}.view`);
const work = (...m: string[]) => m.flatMap((x) => [`${x}.view`, `${x}.create`]);
const lead = (...m: string[]) => m.flatMap((x) => [`${x}.view`, `${x}.create`, `${x}.edit`, `${x}.approve`]);
export const rights = {
  view,
  work,
  lead,
  everyday: [...work('delegation', 'ticket', 'slip'), ...view('checklist', 'hr')],
};
export const item = (code: string, name: string, unit: string, category: string, extras: Field = {}) => ({
  code,
  name,
  unit,
  category,
  extras,
});
