import type { PrismaClient } from '@mono/db';
import { addDays, localDate } from '@mono/shared';
import { restaurant, type Api, type World, ok } from './pos-kit';

export type ResOut = {
  id: string;
  number: string;
  status: string;
  day: string;
  startMin: number;
  time: string;
  durationMin: number;
  partySize: number;
  tableIds: string[];
  tables: string[];
  deposit: { amount: number; state: string; billId: string | null } | null;
  orderId: string | null;
  order?: { id: string; number: number };
  guest: { id: string; name: string; mobile: string; allergies: string | null; tags: string[] } | null;
};

/**
 * A restaurant that takes bookings: T1 seats 2, T2 and T3 four, T4 six, and T5 and T6 (four each) can be joined.
 * `tomorrow` is always ahead of the clock, whatever the time the tests run.
 */
export async function hostDesk(prisma: PrismaClient, w: World) {
  const r = await restaurant(prisma, w);
  await prisma.diningTable.update({ where: { id: r.t.T1! }, data: { seats: 2 } });
  await prisma.diningTable.update({ where: { id: r.t.T4! }, data: { seats: 6 } });
  await prisma.diningTable.updateMany({
    where: { id: { in: [r.t.T5!, r.t.T6!] } },
    data: { combinable: true },
  });
  const today = localDate(new Date(), 'Asia/Kolkata');
  const tomorrow = addDays(today, 1);
  let n = 0;
  /** Book as a person (the steward by default): a new guest each time unless a mobile is given. */
  const bookAs = (api: Api, body: Record<string, unknown> = {}) =>
    api.post('/api/reservations', {
      outletId: r.outlet,
      day: tomorrow,
      startMin: 19 * 60,
      partySize: 2,
      guest: {
        name: `Guest ${++n}`,
        mobile: `98${String(Date.now()).slice(-6)}${String(n).padStart(2, '0')}`,
      },
      ...body,
    });
  const reserve = (body: Record<string, unknown> = {}) => ok<ResOut>(bookAs(r.steward.api, body));
  const act = (id: string, action: string, more: object = {}, api: Api = r.steward.api) =>
    api.post(`/api/reservations/${id}/act`, { action, ...more });
  const events = async (name: string) =>
    (await prisma.domainEvent.findMany({ where: { companyId: w.companyId, name } })).map(
      (e) => e.payload as Record<string, unknown>,
    );
  return {
    r,
    today,
    tomorrow,
    bookAs,
    reserve,
    act,
    events,
    names: (ids: string[]) => ids.map((id) => Object.entries(r.t).find(([, v]) => v === id)?.[0]),
  };
}
export type HostDesk = Awaited<ReturnType<typeof hostDesk>>;
