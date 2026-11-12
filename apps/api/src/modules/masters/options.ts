import type { Db, Tx } from '@mono/db';
import { makeRef, parseRef, refsOf, type PermissionKey } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import type { MasterOption, OptionQuery, SourceHandler } from './sources';
import { fmsValueSource } from './sources/fms';
import { listSource } from './sources/list';
import { recordSource } from './sources/rec';
import { mayReadRecordType, recordTypeSource } from './sources/record-type';

export type { MasterOption, OptionQuery } from './sources';

const like = (q: string) => (q.trim() ? { contains: q.trim(), mode: 'insensitive' as const } : undefined);
/** The rows asked for by id (checking a picked link), else the rows matching the search. */
const only = <W extends object>(query: OptionQuery, search: W) =>
  query.ids ? { id: { in: query.ids } } : search;
const text = (v: unknown) =>
  v === undefined || v === null || typeof v === 'object' ? '' : String(v).trim().toLowerCase();

/**
 * Dependent choices (`filterBy`): keep the rows whose column equals the other field's value. When the row's
 * column and the other field are both links of the same kind, the links are compared, so a renamed parent still
 * finds its rows; otherwise the text is (ignoring case and surrounding spaces).
 */
export function matchesFilter(o: MasterOption, f: OptionQuery['filter']): boolean {
  if (!f) return true;
  const linked = refsOf(o.columns)[f.column];
  if (linked && f.ref && parseRef(linked)?.kind === parseRef(f.ref)?.kind) return linked === f.ref;
  return text(o.columns?.[f.column]) === text(f.value);
}

const customers: SourceHandler = async (db, actor, _arg, query) =>
  (
    await db.customer.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        ...only(query, like(query.q) ? { name: like(query.q) } : {}),
      },
      orderBy: { name: 'asc' },
      take: query.limit,
      select: { id: true, name: true, city: true, code: true, mobile: true, segment: true },
    })
  ).map((c) => ({
    value: c.name,
    label: c.name,
    sub: [c.code, c.city].filter(Boolean).join(' · '),
    ref: makeRef('customer', c.id),
    columns: { name: c.name, code: c.code, city: c.city, mobile: c.mobile, segment: c.segment },
  }));

const items: SourceHandler = async (db, actor, _arg, query) =>
  (
    await db.item.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        active: true,
        ...only(query, like(query.q) ? { OR: [{ name: like(query.q) }, { code: like(query.q) }] } : {}),
      },
      orderBy: { code: 'asc' },
      take: query.limit,
    })
  ).map((i) => ({
    value: i.name,
    label: i.name,
    sub: `${i.code} · ${i.unit}`,
    ref: makeRef('item', i.id),
    columns: {
      name: i.name,
      code: i.code,
      unit: i.unit,
      category: i.category,
      location: i.location,
      vendor: i.vendor,
      // Rupees, as forms hold amounts (the item keeps paise).
      rate: Number(i.rate) / 100,
      stock: Number(i.stock),
    },
  }));

const people: SourceHandler = async (db, actor, _arg, query) =>
  (
    await db.user.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        status: 'ACTIVE',
        ...only(query, like(query.q) ? { name: like(query.q) } : {}),
      },
      orderBy: { name: 'asc' },
      take: query.limit,
      select: {
        id: true,
        name: true,
        code: true,
        mobile: true,
        designation: { select: { name: true } },
        mainDepartment: { select: { name: true } },
      },
    })
  ).map((u) => ({
    value: u.name,
    label: u.name,
    sub: u.designation?.name ?? null,
    ref: makeRef('user', u.id),
    columns: {
      name: u.name,
      code: u.code,
      mobile: u.mobile,
      designation: u.designation?.name ?? null,
      department: u.mainDepartment?.name ?? null,
    },
  }));

/** A custom master: the row's own values are its columns. */
const customMaster: SourceHandler = async (db, actor, masterId, query) => {
  const m = await db.masterDef.findFirst({
    where: { id: masterId, companyId: actor.companyId, deletedAt: null },
    select: { id: true },
  });
  if (!m) throw new AppError(404, 'NOT_FOUND', 'Master not found');
  return (
    await db.masterRow.findMany({
      where: {
        masterId,
        companyId: actor.companyId,
        deletedAt: null,
        ...only(query, like(query.q) ? { OR: [{ label: like(query.q) }, { key: like(query.q) }] } : {}),
      },
      orderBy: { label: 'asc' },
      take: query.limit,
      select: { id: true, label: true, key: true, data: true },
    })
  ).map((r) => ({
    value: r.label,
    label: r.label,
    sub: r.key && r.key !== r.label ? r.key : null,
    ref: makeRef('row', r.id),
    columns: (r.data ?? {}) as Record<string, unknown>,
  }));
};

/** The company's "Vendors" master, when it has one (the vendors source reads it). */
export async function vendorsMaster(db: Db | Tx, companyId: string) {
  return db.masterDef.findFirst({
    where: { companyId, deletedAt: null, name: { equals: 'Vendors', mode: 'insensitive' } },
    select: { id: true },
  });
}

/** Vendors: a "Vendors" master if there is one, else the vendors typed on items. */
const vendors: SourceHandler = async (db, actor, _arg, query) => {
  const companyId = actor.companyId;
  const master = await vendorsMaster(db, companyId);
  if (master) return customMaster(db, actor, master.id, query);
  if (query.ids) return []; // names typed on items are not rows: nothing to link to
  const names = await db.item.findMany({
    where: { companyId, deletedAt: null, vendor: like(query.q) ?? { not: null } },
    distinct: ['vendor'],
    select: { vendor: true },
    take: query.limit,
  });
  return names.filter((n) => n.vendor).map((n) => ({ value: n.vendor!, label: n.vendor!, sub: null }));
};

/** Sources by their prefix: `customers`, `m:<id>`, `fms:<flowId>:<field>`, `rec:<flowId>`, `list:<key>`, `rt:<id>`. */
const SOURCES: Record<string, SourceHandler> = {
  customers,
  items,
  people,
  vendors,
  m: customMaster,
  fms: fmsValueSource,
  rec: recordSource,
  list: listSource,
  rt: recordTypeSource,
};

/** Sources that read other processes' data need more than a sign-in. */
const NEEDS: Record<string, PermissionKey> = { fms: 'fms.view', rec: 'fms.view' };

/** With a dependent-choice filter the match is made here, so the handler is asked for more rows than are shown. */
const FILTER_SCAN = 2000;

const prefixOf = (source: string) => {
  const i = source.indexOf(':');
  return i < 0 ? { prefix: source, arg: '' } : { prefix: source.slice(0, i), arg: source.slice(i + 1) };
};

/** A source's rows, company-scoped, with the dependent-choice filter applied. No permission check: see `masterOptions`. */
export async function sourceRows(
  db: Db | Tx,
  actor: Actor,
  source: string,
  query: OptionQuery,
): Promise<MasterOption[]> {
  const { prefix, arg } = prefixOf(source);
  const handler = SOURCES[prefix];
  if (!handler) throw new AppError(400, 'VALIDATION_FAILED', 'Unknown master');
  const limit = query.filter && !query.ids ? FILTER_SCAN : query.limit;
  const rows = await handler(db as Db, actor, arg, { ...query, limit });
  return rows.filter((o) => matchesFilter(o, query.filter)).slice(0, query.limit);
}

/**
 * What a "from a master" field offers (CLAUDE.md §8 "enter it once, every module reads the same customer, item and
 * person"). The value kept is the text shown — readable in records and documents — and `ref` links it to its row.
 */
export async function masterOptions(
  db: Db,
  actor: Actor,
  source: string,
  q = '',
  limit = 50,
  extra: Pick<OptionQuery, 'filter' | 'rec'> = {},
): Promise<MasterOption[]> {
  const { prefix, arg } = prefixOf(source);
  const need = NEEDS[prefix];
  if (need && !can(actor, need))
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to the processes this list reads');
  if (prefix === 'rt') await mayReadRecordType(db, actor, arg);
  return sourceRows(db, actor, source, { q, limit: Math.min(200, Math.max(1, limit)), ...extra });
}

/**
 * The rows behind some links, by link — only those that exist in this company and belong to `source` (and, for
 * records, that the field's `rec` filter would offer). A link that is not in the answer is not valid for the field.
 */
export async function lookupRefs(
  db: Db | Tx,
  actor: Actor,
  source: string,
  refs: string[],
  extra: Pick<OptionQuery, 'rec'> = {},
): Promise<Map<string, MasterOption>> {
  const ids = [...new Set(refs.map((r) => parseRef(r)?.id).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  let rows: MasterOption[] = [];
  try {
    rows = await sourceRows(db, actor, source, { q: '', limit: ids.length, ids, ...extra });
  } catch (e) {
    // The source itself is gone (a deleted master, an unknown prefix): no link to it is valid.
    if (!(e instanceof AppError)) throw e;
  }
  const wanted = new Set(refs);
  return new Map(rows.filter((o) => o.ref && wanted.has(o.ref)).map((o) => [o.ref!, o]));
}
