import type { Db } from '@mono/db';
import { addDays, localDate } from '@mono/shared';
import { AppError } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { branchWhere, need } from './access';
import { resView } from './reservations';

const MAX_DAYS = 62;

/**
 * The book over several days, at one outlet or at every outlet the person may see: each booking with its outlet
 * and day, in day and time order, with the counts of each day — the owner's one look at what is coming.
 */
export async function bookSpan(
  db: Db,
  actor: Actor,
  q: { from?: string | undefined; to?: string | undefined; outletId?: string | undefined },
) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  const today = localDate(new Date(), company.timezone);
  const from = q.from ?? today;
  const to = q.to ?? addDays(from, 6);
  if (to < from) throw new AppError(400, 'BAD_REQUEST', 'The last day is before the first');
  if (addDays(from, MAX_DAYS - 1) < to)
    throw new AppError(400, 'BAD_REQUEST', `Choose at most ${MAX_DAYS} days at a time`);
  const outlets = await db.outlet.findMany({
    where: { companyId: actor.companyId, deletedAt: null, ...branchWhere() },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const ids = outlets.filter((o) => !q.outletId || o.id === q.outletId).map((o) => o.id);
  const [rows, tables] = await Promise.all([
    db.reservation.findMany({
      where: { companyId: actor.companyId, outletId: { in: ids }, day: { gte: from, lte: to } },
      orderBy: [{ day: 'asc' }, { startMin: 'asc' }, { number: 'asc' }],
      take: 2_000,
    }),
    db.diningTable.findMany({
      where: { companyId: actor.companyId, outletId: { in: ids }, deletedAt: null },
      orderBy: { name: 'asc' },
    }),
  ]);
  const guests = new Map(
    (await db.guest.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.guestId))] } } })).map(
      (g) => [g.id, g],
    ),
  );
  const nameOf = new Map(outlets.map((o) => [o.id, o.name]));
  const dead = ['CANCELLED', 'NO_SHOW'];
  const count = (list: typeof rows) => {
    const live = list.filter((r) => !dead.includes(r.status));
    return {
      bookings: live.length,
      covers: live.reduce((n, r) => n + r.partySize, 0),
      toConfirm: list.filter((r) => r.status === 'REQUESTED').length,
      noShows: list.filter((r) => r.status === 'NO_SHOW').length,
    };
  };
  const days = [...new Set(rows.map((r) => r.day))].map((day) => ({
    day,
    ...count(rows.filter((r) => r.day === day)),
  }));
  return {
    from,
    to,
    today,
    outlets,
    counts: count(rows),
    days,
    reservations: rows.map((r) => ({
      ...resView(r, guests.get(r.guestId), tables),
      outlet: nameOf.get(r.outletId) ?? '?',
    })),
  };
}
