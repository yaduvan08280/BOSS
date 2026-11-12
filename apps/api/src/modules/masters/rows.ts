import { brandGuard, placeAt } from '../branches/reach';
import type { Db } from '@mono/db';
import { checkFields, fieldSchema, MASTER_LIBRARY, splitTable, type FlowField } from '@mono/shared';
import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { emitEvent, recordChange } from '../../lib/events';
import { checkForm, commitForm, releaseForm, storedValues, type FormScope } from '../forms';
import { AppError, notFound } from '../../lib/errors';
import { saveMaster } from '../ai/masters';
import { can, type Actor } from '../work/actor';

const ctxOf = (actor: Actor) => ({ ...actor, actorId: actor.userId });
const needEdit = (actor: Actor) => {
  if (!can(actor, 'core.edit')) throw new AppError(403, 'FORBIDDEN', 'Only admins change masters');
};

async function loadMaster(db: Db, companyId: string, id: string) {
  const m = await db.masterDef.findFirst({ where: { id, companyId, deletedAt: null } });
  if (!m) throw notFound('Master');
  const fields = z.array(fieldSchema).parse(m.fields);
  return { ...m, fields };
}

/** The key (when the master has one) and the text a row shows as. */
function keyAndLabel(
  m: { fields: FlowField[]; keyField: string | null; displayField: string | null },
  values: Record<string, unknown>,
) {
  const text = (k: string | null | undefined) =>
    k && values[k] !== undefined && values[k] !== null ? String(values[k]).trim() : '';
  const key = text(m.keyField) || null;
  const firstText = m.fields.find(
    (f) => ['text', 'longtext', 'mobile', 'email'].includes(f.type) && text(f.key),
  );
  const label = text(m.displayField) || key || (firstText ? text(firstText.key) : '') || '—';
  return { key, label: label.slice(0, 200) };
}

/** A master's rows (CLAUDE.md §8): newest first, searchable by any text. */
export async function listRows(db: Db, actor: Actor, masterId: string, q?: string) {
  const m = await loadMaster(db, actor.companyId, masterId);
  const where = {
    masterId,
    deletedAt: null,
    ...(q?.trim() ? { label: { contains: q.trim(), mode: 'insensitive' as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.masterRow.findMany({ where, orderBy: { label: 'asc' }, take: 1000 }),
    db.masterRow.count({ where: { masterId, deletedAt: null } }),
  ]);
  return {
    master: {
      id: m.id,
      name: m.name,
      description: m.description,
      fields: m.fields,
      keyField: m.keyField,
      displayField: m.displayField,
      source: m.source,
    },
    rows: rows.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      data: r.data,
      branchId: r.branchId,
      updatedAt: r.updatedAt,
    })),
    total,
    canEdit: can(actor, 'core.edit'),
  };
}

async function keyFree(db: Db, masterId: string, key: string | null, notId?: string) {
  if (!key) return;
  const clash = await db.masterRow.findFirst({
    where: { masterId, key, deletedAt: null, ...(notId ? { id: { not: notId } } : {}) },
  });
  if (clash) throw new AppError(409, 'CONFLICT', `"${key}" is already in this master (${clash.label})`);
}

export async function saveRow(
  db: Db,
  actor: Actor,
  masterId: string,
  input: Record<string, unknown>,
  id?: string,
) {
  needEdit(actor);
  const m = await loadMaster(db, actor.companyId, masterId);
  // `_branchId` is not a field: it says which branch the row is for (null = every branch; left out = unchanged).
  const { _branchId, ...fields } = input;
  input = fields;
  const place =
    _branchId === undefined
      ? undefined
      : await placeAt(db, actor.companyId, typeof _branchId === 'string' && _branchId ? _branchId : null);
  const scope: FormScope = {
    companyId: actor.companyId,
    actorId: actor.userId,
    owner: { kind: 'master', id: masterId },
    // A new row's id is chosen here, so its unique values can be claimed for it.
    recordId: id ?? createId(),
    canAddValues: true,
  };
  const state = await checkForm(db, scope, m.fields, input);
  if (Object.keys(state.errors).length)
    throw new AppError(400, 'VALIDATION_FAILED', Object.values(state.errors)[0]!, { fields: state.errors });
  const values = storedValues(state);
  const { key, label } = keyAndLabel(m, values);
  if (m.keyField && !key)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `${m.fields.find((f) => f.key === m.keyField)?.label ?? m.keyField} is needed`,
    );
  await keyFree(db, masterId, key, id);
  return db.$transaction(async (tx) => {
    const before = id ? await tx.masterRow.findFirst({ where: { id, masterId, deletedAt: null } }) : null;
    if (id && !before) throw notFound('Row');
    if (before) brandGuard(before.branchId);
    await commitForm(tx, scope, m.fields, state);
    const row = id
      ? await tx.masterRow.update({
          where: { id },
          data: { data: values as object, key, label, ...(place !== undefined ? { branchId: place } : {}) },
        })
      : await tx.masterRow.create({
          data: {
            id: scope.recordId,
            companyId: actor.companyId,
            masterId,
            branchId: place ?? null,
            data: values as object,
            key,
            label,
            createdById: actor.userId,
          },
        });
    await recordChange(tx, ctxOf(actor), {
      event: id ? 'master.row_changed' : 'master.row_added',
      entityType: 'master_row',
      entityId: row.id,
      before: before?.data ?? null,
      after: values,
      payload: { masterId, master: m.name, key, label, data: values },
    });
    return { id: row.id, key, label };
  });
}

/** Deleting keeps the row as history; its key is freed so it can be used again. */
export async function deleteRow(db: Db, actor: Actor, masterId: string, id: string) {
  needEdit(actor);
  const row = await db.masterRow.findFirst({
    where: { id, masterId, companyId: actor.companyId, deletedAt: null },
  });
  if (!row) throw notFound('Row');
  brandGuard(row.branchId);
  await db.$transaction(async (tx) => {
    await tx.masterRow.update({ where: { id }, data: { deletedAt: new Date(), key: null } });
    await releaseForm(tx, {
      companyId: actor.companyId,
      owner: { kind: 'master', id: masterId },
      recordId: id,
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'master.row_deleted',
      entityType: 'master_row',
      entityId: id,
      before: row.data,
      payload: { masterId, key: row.key, label: row.label },
    });
  });
  return { ok: true };
}

/**
 * Import rows from Excel, a CSV, a paste or a Google Sheet (a first row naming the fields by label or key): all or
 * nothing, every problem named by line. Duplicate keys (in the file or already in the master) are problems.
 */
export async function importRows(db: Db, actor: Actor, masterId: string, table: string[][]) {
  needEdit(actor);
  // Imported rows are for every branch: not something a franchise does.
  brandGuard(null);
  const m = await loadMaster(db, actor.companyId, masterId);
  if (table.length < 2)
    throw new AppError(400, 'VALIDATION_FAILED', 'Put the field names in the first row and the rows below');
  const norm = (s: string) => s.trim().toLowerCase().replace(/[*:]/g, '').trim();
  const cols = table[0]!.map(
    (h) => m.fields.find((f) => norm(f.label) === norm(h) || f.key === norm(h).replace(/\s+/g, '_')) ?? null,
  );
  if (!cols.some(Boolean))
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `The first row should name the fields: ${m.fields.map((f) => f.label).join(', ')}`,
    );
  const existing = new Set(
    (
      await db.masterRow.findMany({
        where: { masterId, deletedAt: null, key: { not: null } },
        select: { key: true },
      })
    ).map((r) => r.key!.toLowerCase()),
  );
  const seen = new Set<string>();
  const problems: { line: number; error: string }[] = [];
  const rows = table.slice(1).flatMap((cells, i) => {
    if (cells.every((c) => !c.trim())) return [];
    const input: Record<string, unknown> = {};
    cols.forEach((f, k) => {
      if (!f) return;
      const v = (cells[k] ?? '').trim();
      if (!v) return;
      input[f.key] =
        f.type === 'yesno'
          ? /^(y|yes|true|1|हाँ)$/i.test(v)
          : f.type === 'multiselect'
            ? v.split(/\s*[,;]\s*/)
            : f.type === 'date'
              ? toIsoDate(v)
              : v;
    });
    const { values, errors } = checkFields(m.fields, input);
    const line = i + 2;
    for (const e of Object.values(errors)) problems.push({ line, error: e });
    const { key, label } = keyAndLabel(m, values);
    if (m.keyField && !key && !errors[m.keyField])
      problems.push({ line, error: `${m.fields.find((f) => f.key === m.keyField)?.label} is needed` });
    if (key && (existing.has(key.toLowerCase()) || seen.has(key.toLowerCase())))
      problems.push({ line, error: `"${key}" is already there` });
    if (key) seen.add(key.toLowerCase());
    return [{ values, key, label }];
  });
  if (!rows.length) throw new AppError(400, 'VALIDATION_FAILED', 'No rows to import');
  if (problems.length)
    throw new AppError(400, 'VALIDATION_FAILED', `${problems.length} problem(s) to fix`, {
      lines: problems.slice(0, 200),
    });
  await db.$transaction(
    async (tx) => {
      await tx.masterRow.createMany({
        data: rows.map((r) => ({
          companyId: actor.companyId,
          masterId,
          data: r.values as object,
          key: r.key,
          label: r.label,
          createdById: actor.userId,
        })),
      });
      await writeAudit(tx, ctxOf(actor), {
        action: 'master.rows_imported',
        entityType: 'master',
        entityId: masterId,
        after: { count: rows.length },
      });
      await emitEvent(tx, ctxOf(actor), {
        name: 'master.rows_imported',
        entityType: 'master',
        entityId: masterId,
        payload: { masterId, master: m.name, count: rows.length },
      });
    },
    { timeout: 60_000 },
  );
  return { created: rows.length };
}

/** DD/MM/YYYY (or YYYY-MM-DD) → YYYY-MM-DD; anything else is left for the field check to name. */
function toIsoDate(v: string) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : v;
}

/**
 * A Google Sheet shared as "anyone with the link": its CSV export, fetched from docs.google.com only (the URL is
 * rebuilt from the sheet id, so nothing else can be reached), at most 5 MB, 15 seconds.
 */
export async function importSheet(
  db: Db,
  actor: Actor,
  masterId: string,
  url: string,
  f: typeof fetch = fetch,
) {
  needEdit(actor);
  const m =
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/[^?#]*)?(?:[?#].*?gid=(\d+))?/.exec(
      url.trim(),
    );
  if (!m)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'Paste the link of a Google Sheet (docs.google.com/spreadsheets/…)',
    );
  const csvUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${m[2] ? `&gid=${m[2]}` : ''}`;
  let text: string;
  try {
    const res = await f(csvUrl, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!res.ok)
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'The sheet could not be read: share it as "Anyone with the link can view"',
      );
    text = await res.text();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, 'VALIDATION_FAILED', 'The sheet could not be reached');
  }
  if (text.length > 5_000_000)
    throw new AppError(400, 'VALIDATION_FAILED', 'The sheet is too big (5 MB at most)');
  if (/^\s*<(!doctype|html)/i.test(text))
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'The sheet is not shared: set "Anyone with the link can view"',
    );
  return importRows(db, actor, masterId, splitTable(text));
}

/** The Master Library (§8): what is there, and which ones the company already has (by name). */
export async function library(db: Db, actor: Actor) {
  const mine = new Set(
    (
      await db.masterDef.findMany({
        where: { companyId: actor.companyId, deletedAt: null },
        select: { name: true },
      })
    ).map((m) => m.name.toLowerCase()),
  );
  return MASTER_LIBRARY.map((l) => ({ ...l, have: mine.has(l.name.toLowerCase()) }));
}

/** Pick one from the library → a master with its fields. */
export async function useLibrary(db: Db, actor: Actor, key: string) {
  needEdit(actor);
  const l = MASTER_LIBRARY.find((x) => x.key === key);
  if (!l) throw notFound('Library master');
  return saveMaster(db, actor, {
    name: l.name,
    description: l.description,
    fields: l.fields,
    keyField: l.keyField,
    displayField: l.displayField,
    source: 'library',
  });
}
