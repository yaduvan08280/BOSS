import type { PrismaClient } from '@mono/db';
import { addDays, localDate } from '@mono/shared';
import { ok, post, restaurant, type Api, type World } from '../hosp/pos-kit';

export { ok, post };
export type EventOut = {
  id: string;
  number: string;
  status: string;
  guaranteedCovers: number | null;
  actualCovers: number | null;
  totals: { covers: number; taxable: number; tax: number; total: number };
  advance: { needed: number; paid: number } | 'KEPT' | 'RETURNED' | null;
  beoVersion: number;
  beoSentAt: string | null;
  beo: Record<string, string> | null;
  indent: { name: string; unit: string; need: number; have: number; short: number }[];
  checklist: { text: string; dept: string; done: boolean }[];
  invoice: { id: string; number: string; total: number; due: number } | null;
  feedback: { rating: number } | null;
  note: string | null;
  quoteVersion: number;
};

/**
 * A banquet desk at the Rooftop branch (with the restaurant of the POS kit): the Crystal hall (300 theatre, 150
 * round tables, rent ₹25,000 + 18 %), the Garden lawn (500), and the Silver package at ₹800 a plate + 5 % whose
 * one dish is half a paneer tikka a guest (200 g of paneer a plate). The steward sells, the manager manages.
 */
export async function banquets(prisma: PrismaClient, w: World) {
  const r = await restaurant(prisma, w);
  const branchId = r.g.b.rooftop.id;
  await ok(
    w.api.put('/api/money/tax-rates', { code: 'GST18', name: 'GST 18%', percent: 18, from: '2020-01-01' }),
  );
  const hall = (name: string, capacities: object[], rent = 0) =>
    post(w.api, '/api/banquets/halls', {
      branchId,
      name,
      capacities,
      rent,
      rentTaxCode: rent ? 'GST18' : null,
    });
  const crystal = await hall(
    'Crystal',
    [
      { style: 'Theatre', guests: 300 },
      { style: 'Round tables', guests: 150 },
    ],
    25000_00,
  );
  const lawn = await hall('Garden lawn', [{ style: 'Floating', guests: 500 }]);
  const dish = await prisma.item.findFirstOrThrow({ where: { companyId: w.companyId, code: 'D-TIK' } });
  const silver = await post(w.api, '/api/banquets/packages', {
    name: 'Silver',
    pricePerPlate: 800_00,
    taxCode: 'GST5',
    items: [{ itemId: dish.id, name: 'Paneer tikka', perCover: 0.5 }, { name: 'Welcome drink' }],
  });
  const today = localDate(new Date(), 'Asia/Kolkata');
  const d = (n: number) => addDays(today, n);
  let n = 0;
  const sales = r.steward.api;
  const enquire = (body: Record<string, unknown> = {}, api: Api = sales) =>
    api.post('/api/banquets/events', {
      branchId,
      guest: {
        name: `Host ${++n}`,
        mobile: `95${String(Date.now()).slice(-6)}${String(n).padStart(2, '0')}`,
      },
      occasion: 'Wedding reception',
      day: d(30),
      startMin: 19 * 60,
      endMin: 23 * 60,
      hallIds: [crystal.id],
      style: 'Round tables',
      expectedCovers: 100,
      ...body,
    });
  const act = (id: string, what: string, body: object = {}, api: Api = sales) =>
    api.post(`/api/banquets/events/${id}/${what}`, body);
  /** An enquiry quoted at 100 covers of Silver with ₹5,000 of flowers: ₹1,18,500 with tax. */
  const quoted = async (body: Record<string, unknown> = {}) => {
    const e = await ok<EventOut>(enquire(body));
    return ok<EventOut>(
      act(e.id, 'quote', {
        packageId: silver.id,
        guaranteedCovers: 100,
        extras: [{ name: 'Flowers', amount: 5000_00 }],
        locationId: r.kitchenLoc,
      }),
    );
  };
  /** …and confirmed with its 25 % advance in cash. */
  const confirmed = async (body: Record<string, unknown> = {}) => {
    const e = await quoted(body);
    await ok(act(e.id, 'advance', { modeId: r.modes.cash, amount: 29625_00 }));
    return ok<EventOut>(act(e.id, 'confirm'));
  };
  const events = async (name: string) =>
    (await prisma.domainEvent.findMany({ where: { companyId: w.companyId, name } })).map(
      (e) => e.payload as Record<string, unknown>,
    );
  return {
    r,
    w,
    branchId,
    crystal: crystal.id,
    lawn: lawn.id,
    silver: silver.id,
    dish: dish.id,
    today,
    d,
    sales,
    sup: r.manager.api,
    enquire,
    act,
    quoted,
    confirmed,
    events,
  };
}
