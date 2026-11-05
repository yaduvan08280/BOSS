import type { Db } from '@mono/db';
import { AppError } from '../../lib/errors';
import type { Actor } from '../work/actor';

export type MasterOption = { value: string; label: string; sub: string | null };

/**
 * What a "from a master" field offers (CLAUDE.md §8 "enter it once, every module reads the same customer, item and
 * person"): the CRM's customers, the IMS items, the people, vendors (a "Vendors" master if there is one, else the
 * items' vendors), or any custom master (`m:<id>`). The value kept is the text shown — readable in records and
 * documents, and what FMS stock steps match items by.
 */
export async function masterOptions(
  db: Db,
  actor: Actor,
  source: string,
  q = '',
  limit = 50,
): Promise<MasterOption[]> {
  const companyId = actor.companyId;
  const like = q.trim() ? { contains: q.trim(), mode: 'insensitive' as const } : undefined;
  const take = Math.min(200, Math.max(1, limit));
  if (source === 'customers')
    return (
      await db.customer.findMany({
        where: { companyId, deletedAt: null, ...(like ? { name: like } : {}) },
        orderBy: { name: 'asc' },
        take,
        select: { name: true, city: true, code: true },
      })
    ).map((c) => ({ value: c.name, label: c.name, sub: [c.code, c.city].filter(Boolean).join(' · ') }));
  if (source === 'items')
    return (
      await db.item.findMany({
        where: {
          companyId,
          deletedAt: null,
          active: true,
          ...(like ? { OR: [{ name: like }, { code: like }] } : {}),
        },
        orderBy: { code: 'asc' },
        take,
        select: { code: true, name: true, unit: true },
      })
    ).map((i) => ({ value: i.name, label: i.name, sub: `${i.code} · ${i.unit}` }));
  if (source === 'people')
    return (
      await db.user.findMany({
        where: { companyId, deletedAt: null, status: 'ACTIVE', ...(like ? { name: like } : {}) },
        orderBy: { name: 'asc' },
        take,
        select: { name: true, designation: { select: { name: true } } },
      })
    ).map((u) => ({ value: u.name, label: u.name, sub: u.designation?.name ?? null }));
  let masterId: string | null;
  if (source === 'vendors') {
    const vendors = await db.masterDef.findFirst({
      where: { companyId, deletedAt: null, name: { equals: 'Vendors', mode: 'insensitive' } },
      select: { id: true },
    });
    if (!vendors) {
      const names = await db.item.findMany({
        where: { companyId, deletedAt: null, vendor: like ?? { not: null } },
        distinct: ['vendor'],
        select: { vendor: true },
        take,
      });
      return names.filter((n) => n.vendor).map((n) => ({ value: n.vendor!, label: n.vendor!, sub: null }));
    }
    masterId = vendors.id;
  } else if (source.startsWith('m:')) masterId = source.slice(2);
  else throw new AppError(400, 'VALIDATION_FAILED', 'Unknown master');
  const m = await db.masterDef.findFirst({
    where: { id: masterId, companyId, deletedAt: null },
    select: { id: true },
  });
  if (!m) throw new AppError(404, 'NOT_FOUND', 'Master not found');
  return (
    await db.masterRow.findMany({
      where: { masterId, deletedAt: null, ...(like ? { OR: [{ label: like }, { key: like }] } : {}) },
      orderBy: { label: 'asc' },
      take,
      select: { label: true, key: true },
    })
  ).map((r) => ({ value: r.label, label: r.label, sub: r.key && r.key !== r.label ? r.key : null }));
}
