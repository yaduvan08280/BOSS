import type { PrismaClient } from '@mono/db';
import { addDays } from '@mono/shared';
import { ok, post, restaurant, type Api, type World } from '../hosp/pos-kit';

export { ok, post };
export type StayOut = {
  id: string;
  number: string;
  status: string;
  arrive: string;
  depart: string;
  nights: number;
  room: string | null;
  roomId: string | null;
  roomType: string;
  total: number;
  kind: string;
  guest: { id: string; name: string } | null;
  formC: { dueAt: string; filedAt: string | null; missing: string[] } | null;
  keys: number;
  visitors: { name: string; out: string | null }[];
  moves: { from: string; to: string; reason: string | null }[];
  nightly: { day: string; rate: number; room: string | null; posted: boolean }[];
  folios: FolioOut[];
  commissionPct: number;
};
export type FolioOut = {
  id: string;
  no: number;
  name: string;
  status: string;
  partyId: string;
  invoice: { id: string; number: string; total: number; due: number } | null;
  lines: {
    id: string;
    kind: string;
    text: string;
    amount: number;
    qty: number;
    voided: boolean;
    day: string;
  }[];
  charges: number;
  tax: number;
  restaurant: number;
  total: number;
  paid: number;
  due: number;
  advanceLeft?: number;
};

/**
 * A small hotel at the Rooftop branch (which also has the restaurant of the POS kit): four Deluxe rooms
 * (101–104) and two Suites (201–202), a CP plan (Deluxe ₹4,000, Suite ₹8,000, extra adult ₹1,000) and an EP plan,
 * room tax by tariff slab (12 % up to ₹7,500 a night, 18 % above), a company and a travel agent. The steward is
 * the front desk, the manager the supervisor, the owner the admin.
 */
export async function property(prisma: PrismaClient, w: World) {
  const r = await restaurant(prisma, w);
  const branchId = r.g.b.rooftop.id;
  await ok(
    w.api.put('/api/money/tax-rates', {
      code: 'ROOM',
      name: 'GST on rooms',
      percent: 12,
      from: '2020-01-01',
      slabs: [
        { upTo: 7500_00, percent: 12 },
        { upTo: null, percent: 18 },
      ],
    }),
  );
  await ok(
    w.api.put('/api/money/tax-rates', { code: 'GST18', name: 'GST 18%', percent: 18, from: '2020-01-01' }),
  );
  const type = (name: string, code: string, maxOccupancy: number) =>
    post(w.api, '/api/hosp/room-types', {
      branchId,
      name,
      code,
      occupancy: 2,
      maxOccupancy,
      taxCode: 'ROOM',
    });
  const deluxe = await type('Deluxe', 'DLX', 3);
  const suite = await type('Suite', 'STE', 4);
  await post(w.api, '/api/hosp/rooms/bulk', { typeId: deluxe.id, from: 101, to: 104, floor: '1' });
  await post(w.api, '/api/hosp/rooms/bulk', { typeId: suite.id, from: 201, to: 202, floor: '2' });
  const rooms = Object.fromEntries(
    (await prisma.room.findMany({ where: { branchId } })).map((x) => [x.number, x.id]),
  ) as Record<string, string>;
  const party = (name: string, kinds: string[]) =>
    post(w.api, '/api/money/parties', { name, kinds, state: 'Rajasthan' });
  const acme = await party('Acme Corp', ['customer']);
  const agent = await party('Royal Travels', ['customer']);
  const rates = [
    { roomTypeId: deluxe.id, base: 4000_00, extraAdult: 1000_00, extraChild: 500_00 },
    { roomTypeId: suite.id, base: 8000_00, extraAdult: 1500_00 },
  ];
  const plan = (body: object) =>
    post(w.api, '/api/hotel/plans', { branchId, rates, weekendDays: [], ...body });
  const cp = await plan({ code: 'CP', name: 'With breakfast', meal: 'CP' });
  const ep = await plan({
    code: 'EP',
    name: 'Room only',
    meal: 'EP',
    rates: [{ roomTypeId: deluxe.id, base: 3500_00 }],
    weekendDays: [],
  });
  const { businessDate } = await ok<{ businessDate: string }>(
    w.api.get(`/api/hotel/rules?branchId=${branchId}`),
  );
  const d = (n: number) => addDays(businessDate, n);
  let n = 0;
  const desk = r.steward.api;
  /** A booking made at the desk: a new guest each time unless one is given. Arrives today for two nights. */
  const book = (body: Record<string, unknown> = {}, api: Api = desk) =>
    api.post('/api/hotel/stays', {
      branchId,
      ratePlanId: cp.id,
      roomTypeId: deluxe.id,
      arrive: d(0),
      depart: d(2),
      adults: 2,
      guest: {
        name: `Guest ${++n}`,
        mobile: `97${String(Date.now()).slice(-6)}${String(n).padStart(2, '0')}`,
      },
      ...body,
    });
  const booked = (body: Record<string, unknown> = {}) =>
    ok<{ id: string; number: string; total: number; nights: { day: string; rate: number }[] }>(book(body));
  const kyc = {
    idType: 'Aadhaar',
    idNumber: '1234 5678 9012',
    idPhotoId: 'file_id',
    signatureId: 'file_sig',
  };
  const checkIn = (id: string, room: string, more: Record<string, unknown> = {}) =>
    desk.post(`/api/hotel/stays/${id}/check-in`, { roomId: rooms[room], kyc, arrivedMin: 15 * 60, ...more });
  const stay = (id: string, api: Api = desk) => ok<StayOut>(api.get(`/api/hotel/stays/${id}`));
  const audit = () =>
    ok<{
      pack: Record<string, unknown> & { noShows: { number: string; charge: number }[] };
      businessDate: string;
    }>(r.manager.api.post('/api/hotel/night-audit', { branchId }));
  const events = async (name: string) =>
    (await prisma.domainEvent.findMany({ where: { companyId: w.companyId, name } })).map(
      (e) => e.payload as Record<string, unknown>,
    );
  return {
    r,
    w,
    branchId,
    types: { deluxe: deluxe.id, suite: suite.id },
    rooms,
    plans: { cp: cp.id, ep: ep.id },
    rates,
    acme: acme.id,
    agent: agent.id,
    today: businessDate,
    d,
    desk,
    sup: r.manager.api,
    book,
    booked,
    kyc,
    checkIn,
    stay,
    audit,
    events,
  };
}
export type Property = Awaited<ReturnType<typeof property>>;
