import { createId } from '@paralleldrive/cuid2';
import type { Db } from '@mono/db';
import {
  formatDateTime,
  formatLocalDate,
  listable,
  plainValues,
  recordTitleOf,
  type FlowField,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { checkForm, commitForm, storedValues, type FormState } from '../forms';
import type { Actor } from '../work/actor';
import { ctxOf, loadType, mustBeActive } from './access';
import { columnsOf, scopeOf, type ListQuery } from './list';
import { fyNow, recordCode, takeNumbers } from './numbering';
import { queryRecords } from './query';
import { formScope } from './records';
import { toCsv, toXlsx, type Cell } from './xlsx';
import { homeBranchOf } from '../branches/reach';

export const IMPORT_MAX_ROWS = 2000;
export const EXPORT_MAX_ROWS = 10_000;

const BUILTIN_LABELS: Record<string, string> = {
  code: 'Number',
  title: 'Title',
  status: 'Status',
  createdAt: 'Made on',
  createdBy: 'Made by',
};

function cellOf(f: FlowField, v: unknown, tz: string): Cell {
  if (v === undefined || v === null || v === '') return '';
  if (f.type === 'date' && typeof v === 'string') return formatLocalDate(v);
  if (f.type === 'datetime' && typeof v === 'string') return formatDateTime(v, tz);
  if (f.type === 'yesno') return v === true ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (typeof v === 'number') return v;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/**
 * The current list as a file (U5): the same search, filters and sort as the screen, every matching record (not
 * one page), the chosen columns — or with `all`, every field a list can show. Dates read DD/MM/YYYY.
 */
export async function exportRecords(
  db: Db,
  actor: Actor,
  typeId: string,
  query: ListQuery & { format: 'csv' | 'xlsx'; all?: boolean },
) {
  const t = await loadType(db, actor, typeId, 'view');
  const scope = await scopeOf(db, actor, t);
  const columns = query.all
    ? [
        'code',
        'title',
        'status',
        ...t.def.fields.filter(listable).map((f) => f.key),
        'createdAt',
        'createdBy',
      ]
    : columnsOf(t.def, query.columns);
  const { rows, total } = await queryRecords(db, scope, t.def, query, { skip: 0, take: EXPORT_MAX_ROWS });
  if (total > EXPORT_MAX_ROWS)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `${total} records match: narrow the list to ${EXPORT_MAX_ROWS} or fewer to export it`,
    );
  const field = (key: string) => t.def.fields.find((f) => f.key === key);
  const status = (key: string) => t.def.statuses.find((s) => s.key === key)?.label ?? key;
  const table: Cell[][] = [
    columns.map((c) => field(c)?.label ?? BUILTIN_LABELS[c] ?? c),
    ...rows.map((r) => {
      const values = plainValues(r.data);
      return columns.map((c): Cell => {
        const f = field(c);
        if (f) return cellOf(f, values[c], scope.tz);
        if (c === 'code') return r.code;
        if (c === 'title') return r.title;
        if (c === 'status') return status(r.status);
        if (c === 'createdAt') return formatDateTime(r.createdAt, scope.tz);
        return r.createdBy ?? '';
      });
    }),
  ];
  const name = (t.code ?? 'records').replace(/[^a-z0-9_]/g, '_');
  return query.format === 'xlsx'
    ? {
        filename: `${name}.xlsx`,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: toXlsx(t.pluralName, table),
        count: rows.length,
      }
    : { filename: `${name}.csv`, mime: 'text/csv; charset=utf-8', body: toCsv(table), count: rows.length };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[*:]/g, '').trim();

/** DD/MM/YYYY (or YYYY-MM-DD) → YYYY-MM-DD; anything else is left for the field check to name. */
function toIsoDate(v: string) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : v;
}

function cellValue(f: FlowField, v: string): unknown {
  if (f.type === 'yesno')
    return /^(y|yes|true|1|हाँ)$/i.test(v) ? true : /^(n|no|false|0|नहीं)$/i.test(v) ? false : v;
  if (f.type === 'multiselect') return v.split(/\s*[,;]\s*/).filter(Boolean);
  if (f.type === 'date') return toIsoDate(v);
  return v;
}

/**
 * Import records from Excel, a CSV or a paste (U5): the first row names the fields by label or key. All or
 * nothing — every problem is named with its line, and nothing is saved until the whole table is clean. Each row
 * goes through the same form pipeline as a record typed on screen, starts in the start status and takes the next
 * number of the series. (Child lines are not imported.)
 */
export async function importRecords(db: Db, actor: Actor, typeId: string, table: string[][]) {
  const t = await loadType(db, actor, typeId, 'create');
  mustBeActive(t);
  if (table.length < 2)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'Put the field names in the first row and the records below',
    );
  const fields = t.def.fields.filter(
    (f) => !['photo', 'file', 'signature', 'items', 'formula'].includes(f.type),
  );
  const cols = table[0]!.map(
    (h) => fields.find((f) => norm(f.label) === norm(h) || f.key === norm(h).replace(/\s+/g, '_')) ?? null,
  );
  if (!cols.some(Boolean))
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `The first row should name the fields: ${fields.map((f) => f.label).join(', ')}`,
    );
  const problems: { line: number; error: string }[] = [];
  const rows: { line: number; id: string; state: FormState }[] = [];
  for (const [i, cells] of table.slice(1).entries()) {
    if (cells.every((c) => !c.trim())) continue;
    const line = i + 2;
    if (rows.length >= IMPORT_MAX_ROWS) {
      problems.push({ line, error: `${IMPORT_MAX_ROWS} records at most in one import: split the file` });
      break;
    }
    const input: Record<string, unknown> = {};
    cols.forEach((f, k) => {
      const v = (cells[k] ?? '').trim();
      if (f && v) input[f.key] = cellValue(f, v);
    });
    const id = createId();
    const state = await checkForm(db, formScope(actor, t, id), t.def.fields, input);
    for (const e of Object.values(state.errors)) problems.push({ line, error: e });
    rows.push({ line, id, state });
  }
  if (!rows.length) throw new AppError(400, 'VALIDATION_FAILED', 'No records to import');
  const refuse = () =>
    new AppError(400, 'VALIDATION_FAILED', `${problems.length} problem(s) to fix`, {
      lines: problems.slice(0, 200),
    });
  if (problems.length) throw refuse();
  return db.$transaction(
    async (tx) => {
      const fy = await fyNow(tx, actor.companyId);
      const first = await takeNumbers(tx, actor.companyId, t.id, fy, rows.length);
      const data = [];
      const branchId = await homeBranchOf(tx, actor.companyId, actor.userId);
      for (const [k, row] of rows.entries()) {
        try {
          // A stage may refuse here what it could not see before (the same unique value twice in one file).
          await commitForm(tx, formScope(actor, t, row.id), t.def.fields, row.state);
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          problems.push({ line: row.line, error: e.message });
          throw refuse();
        }
        const values = storedValues(row.state);
        const code = recordCode(t.prefix, fy, first + k);
        data.push({
          id: row.id,
          companyId: actor.companyId,
          branchId,
          typeId: t.id,
          number: first + k,
          fy,
          code,
          title: recordTitleOf(t.def, values, code),
          status: t.def.start,
          data: values as object,
          createdById: actor.userId,
        });
      }
      await tx.recordEntry.createMany({ data });
      await tx.recordEvent.createMany({
        data: data.map((r) => ({
          companyId: actor.companyId,
          recordId: r.id,
          type: 'created',
          actorId: actor.userId,
          data: { imported: true },
        })),
      });
      await writeAudit(tx, ctxOf(actor), {
        action: 'record.imported',
        entityType: 'record_type',
        entityId: t.id,
        after: { count: data.length, from: data[0]!.code, to: data.at(-1)!.code },
      });
      await emitEvent(tx, ctxOf(actor), {
        name: 'record.imported',
        entityType: 'record_type',
        entityId: t.id,
        payload: {
          typeId: t.id,
          type: t.name,
          typeCode: t.code,
          count: data.length,
          from: data[0]!.code,
          to: data.at(-1)!.code,
        },
      });
      return { created: data.length, from: data[0]!.code, to: data.at(-1)!.code };
    },
    { timeout: 120_000 },
  );
}
