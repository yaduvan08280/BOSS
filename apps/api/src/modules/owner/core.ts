import type { Db } from '@mono/db';
import { addDays, localDate, zonedToUtc } from '@mono/shared';
import { forbidden } from '../../lib/errors';
import { can, type Actor } from '../work/actor';

/** The owner's desk is for the people who run the company (Owner and Admin). */
export function needOwner(actor: Actor) {
  if (!can(actor, 'core.admin')) throw forbidden("The owner's desk is for the owner and admins");
}

export type Span = { from: string; to: string; start: Date; end: Date; tz: string; today: string };

/** A span of company-local days (default: the last 7 full days) as plain days and as instants. */
export async function spanOf(db: Db, companyId: string, from?: string, to?: string): Promise<Span> {
  const { timezone: tz } = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const today = localDate(new Date(), tz);
  const last = to ?? addDays(today, -1);
  const first = from ?? addDays(last, -6);
  return {
    from: first,
    to: last,
    start: zonedToUtc(first, 0, tz),
    end: zonedToUtc(addDays(last, 1), 0, tz),
    tz,
    today,
  };
}

export const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
export const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/** Branch names, who manages each, and which branch a stock location or an outlet belongs to. */
export async function places(db: Db, companyId: string) {
  const [branches, managers, locations, outlets, people] = await Promise.all([
    db.branch.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, type: true },
    }),
    db.branchManager.findMany({
      where: { companyId, role: 'MANAGER', branchId: { not: null } },
      select: { branchId: true, userId: true },
    }),
    db.location.findMany({ where: { companyId }, select: { id: true, branchId: true, name: true } }),
    db.outlet.findMany({ where: { companyId }, select: { id: true, branchId: true, name: true } }),
    db.user.findMany({
      where: { companyId },
      select: { id: true, name: true, branchId: true, reportsToId: true, status: true, deletedAt: true },
    }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  return {
    branches,
    people,
    name: (id: string | null | undefined) => (id ? (name.get(id) ?? '—') : '—'),
    managerOf: (branchId: string) =>
      managers
        .filter((m) => m.branchId === branchId)
        .map((m) => name.get(m.userId) ?? '')
        .filter(Boolean)
        .join(', ') || null,
    branchOfLocation: new Map(locations.map((l) => [l.id, l.branchId])),
    locationName: new Map(locations.map((l) => [l.id, l.name])),
    branchOfOutlet: new Map(outlets.map((o) => [o.id, o.branchId])),
    outletName: new Map(outlets.map((o) => [o.id, o.name])),
  };
}
