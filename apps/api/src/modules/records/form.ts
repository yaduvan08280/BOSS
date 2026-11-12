import type { Db, Tx } from '@mono/db';
import type { FlowField, RecordDefinition, RecordTable } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { checkForm, commitForm, storedValues, type FormScope, type FormState } from '../forms';

export type RecordInput = { data: Record<string, unknown>; lines?: Record<string, unknown> };
export type Lines = Record<string, Record<string, unknown>[]>;

const MAX_ROWS = 200;
const empty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export type CheckedRecord = {
  state: FormState;
  /** Per table: the rows that hold something, each checked like a small form of its own. */
  tables: { table: RecordTable; rows: FormState[] }[];
  /** Everything wrong: by field, and by table → line number (from 1) → column. */
  problems: { fields: Record<string, string>; lines: Record<string, Record<number, Record<string, string>>> };
  first: string | null;
};

/**
 * Check a record's fields and its child lines through the shared form pipeline (links, lists, formulas, unique
 * values). A line is a form of the table's columns; it can read the record's own values (`known`).
 * `lines` left out keeps the tables as they are (`keep`), so a change of fields alone does not empty them.
 */
export async function checkRecord(
  db: Db | Tx,
  scope: FormScope,
  def: RecordDefinition,
  input: RecordInput,
): Promise<CheckedRecord> {
  const state = await checkForm(db, scope, def.fields, input.data ?? {});
  const problems: CheckedRecord['problems'] = { fields: state.errors, lines: {} };
  let first = Object.values(state.errors)[0] ?? null;
  const tables: CheckedRecord['tables'] = [];
  for (const table of def.tables) {
    const raw = input.lines?.[table.key];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      first ??= `${table.label}: send the lines as a list`;
      problems.lines[table.key] = { 0: { _: 'Send the lines as a list' } };
      continue;
    }
    const filled = (raw as Record<string, unknown>[]).filter(
      (r) => r && typeof r === 'object' && table.fields.some((f) => !empty(r[f.key])),
    );
    if (filled.length > MAX_ROWS) {
      first ??= `${table.label}: ${MAX_ROWS} lines at most`;
      problems.lines[table.key] = { 0: { _: `${MAX_ROWS} lines at most` } };
      continue;
    }
    const rows: FormState[] = [];
    for (const [i, row] of filled.entries()) {
      const s = await checkForm(db, { ...scope, known: state.values }, table.fields, row);
      rows.push(s);
      if (Object.keys(s.errors).length) {
        (problems.lines[table.key] ??= {})[i + 1] = s.errors;
        first ??= `${table.label}, line ${i + 1}: ${Object.values(s.errors)[0]}`;
      }
    }
    tables.push({ table, rows });
  }
  return { state, tables, problems, first };
}

export function refuseIfInvalid(checked: CheckedRecord) {
  if (checked.first) throw new AppError(400, 'VALIDATION_FAILED', checked.first, checked.problems);
}

/** Inside the saving transaction: let the form stages record what they need, and hand back what to store. */
export async function commitRecord(
  tx: Tx,
  scope: FormScope,
  def: RecordDefinition,
  checked: CheckedRecord,
  keep: Lines = {},
): Promise<{ data: Record<string, unknown>; lines: Lines }> {
  await commitForm(tx, scope, def.fields, checked.state);
  const lines: Lines = {};
  for (const t of def.tables) if (keep[t.key]?.length) lines[t.key] = keep[t.key]!;
  for (const { table, rows } of checked.tables) {
    for (const row of rows)
      await commitForm(tx, { ...scope, known: checked.state.values }, table.fields, row);
    lines[table.key] = rows.map(storedValues);
  }
  return { data: storedValues(checked.state), lines };
}

const FILE_TYPES = ['photo', 'file', 'signature'];
const idsIn = (fields: FlowField[], values: Record<string, unknown>) =>
  fields
    .filter((f) => FILE_TYPES.includes(f.type))
    .flatMap((f) => {
      const v = values[f.key];
      return typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : [];
    });

/** The upload ids held by photo / file / signature fields (of the record and of its lines). */
export function fileIdsOf(def: RecordDefinition, data: Record<string, unknown>, lines: Lines): string[] {
  return [
    ...idsIn(def.fields, data),
    ...def.tables.flatMap((t) => (lines[t.key] ?? []).flatMap((row) => idsIn(t.fields, row))),
  ];
}
