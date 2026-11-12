import type { Db } from '@mono/db';
import { makeRef } from '@mono/shared';
import { AppError } from '../../lib/errors';
import type { Actor } from '../work/actor';
import type { MasterOption, OptionQuery, SourceHandler } from './sources';
import { fmsValueSource } from './sources/fms';
import { listSource } from './sources/list';
import { recordSource } from './sources/rec';
import { recordTypeSource } from './sources/record-type';

export type { MasterOption, OptionQuery } from './sources';

const like = (q: string) => (q.trim() ? { contains: q.trim(), mode: 'insensitive' as const } : undefined);

/** Dependent choices (`filterBy`): keep the rows whose column equals the other field's value. */
const matches = (o: MasterOption, f: OptionQuery['filter']) =>
  !f || String(o.columns?.[f.column] ?? '').toLowerCase() === f.value.trim().toLowerCase();

const customers: SourceHandler = async (db, actor, _arg, { q, limit }) =>
  (
    await db.customer.findMany({
      where: { companyId: actor.companyId, deletedAt: null, ...(like(q) ? { name: like(q) } : {}) },
      orderBy: { name: 'asc' },
      take: limit,
      select: { id: true, name: true, city: true, code: true, mobile: true, segment: true },
    })
  ).map((c) => ({
    value: c.name,
    label: c.name,
    sub: [c.code, c.city].filter(Boolean).join(' · '),
    ref: makeRef('customer', c.id),
    columns: { name: c.name, code: c.code, city: c.city, mobile: c.mobile, segment: c.segment },
  }));

const items: SourceHandler = async (db, actor, _arg, { q, limit }) =>
  (
    await db.item.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        active: true,
        ...(like(q) ? { OR: [{ name: like(q) }, { code: like(q) }] } : {}),
      },
      orderBy: { code: 'asc' },
      take: limit,
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

const people: SourceHandler = async (db, actor, _arg, { q, limit }) =>
  (
    await db.user.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(like(q) ? { name: like(q) } : {}),
      },
      orderBy: { name: 'asc' },
      take: limit,
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
const customMaster: SourceHandler = async (db, actor, masterId, { q, limit }) => {
  const m = await db.masterDef.findFirst({
    where: { id: masterId, companyId: actor.companyId, deletedAt: null },
    select: { id: true },
  });
  if (!m) throw new AppError(404, 'NOT_FOUND', 'Master not found');
  return (
    await db.masterRow.findMany({
      where: {
        masterId,
        deletedAt: null,
        ...(like(q) ? { OR: [{ label: like(q) }, { key: like(q) }] } : {}),
      },
      orderBy: { label: 'asc' },
      take: limit,
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

/** Vendors: a "Vendors" master if there is one, else the vendors typed on items. */
const vendors: SourceHandler = async (db, actor, _arg, query) => {
  const companyId = actor.companyId;
  const master = await db.masterDef.findFirst({
    where: { companyId, deletedAt: null, name: { equals: 'Vendors', mode: 'insensitive' } },
    select: { id: true },
  });
  if (master) return customMaster(db, actor, master.id, query);
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
  const i = source.indexOf(':');
  const handler = SOURCES[i < 0 ? source : source.slice(0, i)];
  if (!handler) throw new AppError(400, 'VALIDATION_FAILED', 'Unknown master');
  const query: OptionQuery = { q, limit: Math.min(200, Math.max(1, limit)), ...extra };
  const rows = await handler(db, actor, i < 0 ? '' : source.slice(i + 1), query);
  return rows.filter((o) => matches(o, query.filter));
}
