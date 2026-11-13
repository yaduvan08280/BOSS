import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { banquets, type EventOut } from '../banquet/banquet-kit';
import { add, bill, ok, open, post } from '../hosp/pos-kit';
import { hostDesk, type ResOut } from '../hosp/res-kit';
import { property } from '../hotel/hotel-kit';
import { world } from '../records/testkit';
import { actor, outside } from './connect-kit';
import { integrationHealth } from './health';
import { createPayLink, gatewayWebhook } from './paylinks';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Link = { id: string; url: string; amount: number; status: string; note: string | null };
type World = Awaited<ReturnType<typeof world>>;
const razorpay = (w: World) =>
  ok<{ hookPath: string }>(
    w.api.put('/api/connect/connections', {
      kind: 'GATEWAY',
      provider: 'razorpay',
      secret: { keyId: 'rzp_test_1', keySecret: 'rzp-secret', webhookSecret: 'whsec-1' },
    }),
  );
/** Razorpay as the tests see it: a link is made for whatever is asked. */
const gateway = () =>
  outside((c) =>
    c.url.includes('razorpay')
      ? { json: { id: 'plink_1', short_url: 'https://rzp.io/i/abc' } }
      : { json: { cf_link_id: 991, link_url: 'https://payments.cashfree.com/links/xyz' } },
  );
const paidBody = (reference: string, amount: number, paymentId = 'pay_001') =>
  JSON.stringify({
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: 'plink_1', reference_id: reference, amount_paid: amount } },
      payment: { entity: { id: paymentId, amount } },
    },
  });
const sign = (raw: string, secret = 'whsec-1') => createHmac('sha256', secret).update(raw).digest('hex');
const referenceOf = async (id: string) =>
  (await ctx.prisma.payLink.findUniqueOrThrow({ where: { id } })).reference;

describe(
  'Integrations: the booking page for rooms, payment links, UPI on the bill (phase 19)',
  { timeout: 120_000 },
  () => {
    it('X8: a property’s own booking page shows what can be sold with its price, and takes a booking', async () => {
      const w = await world(ctx.app);
      const h = await property(ctx.prisma, w);
      const rules = () =>
        ok<{ bookingToken: string | null }>(w.api.get(`/api/hotel/rules?branchId=${h.branchId}`));
      // Off until it is switched on: there is no link.
      expect((await rules()).bookingToken).toBeNull();
      await ok(w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, { online: true }));
      const token = (await rules()).bookingToken!;
      expect(token).toBeTruthy();
      const url = `/api/public/rooms/${token}`;
      type Page = {
        property: string;
        arrive: string;
        depart: string;
        offers: {
          room: string;
          plan: string;
          total: number;
          nights: number;
          roomTypeId: string;
          ratePlanId: string;
        }[];
        challenge: { question: string; token: string };
      };
      const page = (q: string) =>
        ctx.app.inject({ method: 'GET', url: `${url}?${q}` }).then((r) => r.json() as Page);
      const first = await page(`arrive=${h.d(2)}&depart=${h.d(4)}&adults=2`);
      // Two nights: Deluxe ₹8,000 with breakfast or ₹7,000 room only; the Suite ₹16,000. No room numbers, no stock.
      expect(first.offers.map((o) => [o.room, o.plan, o.total])).toEqual([
        ['Deluxe', 'Room only', 7000_00],
        ['Deluxe', 'With breakfast', 8000_00],
        ['Suite', 'With breakfast', 16000_00],
      ]);
      expect(JSON.stringify(first)).not.toContain('101');
      // Five guests fit nowhere; a past date is moved to today.
      expect((await page(`arrive=${h.d(2)}&depart=${h.d(4)}&adults=5`)).offers).toEqual([]);
      expect((await page(`arrive=2020-01-01&depart=2020-01-02`)).arrive).toBe(h.d(0));
      // Both suites sold that night: the suite is no longer offered.
      await h.booked({ roomTypeId: h.types.suite, arrive: h.d(2), depart: h.d(3) });
      await h.booked({ roomTypeId: h.types.suite, arrive: h.d(2), depart: h.d(3) });
      expect((await page(`arrive=${h.d(2)}&depart=${h.d(4)}&adults=2`)).offers.map((o) => o.room)).toEqual([
        'Deluxe',
        'Deluxe',
      ]);
      const [x, y] = first.challenge.question.split(' + ').map(Number) as [number, number];
      const deluxe = first.offers[1]!;
      const send = (body: object = {}, answer = x + y) =>
        ctx.app.inject({
          method: 'POST',
          url,
          payload: {
            arrive: h.d(2),
            depart: h.d(4),
            adults: 2,
            roomTypeId: deluxe.roomTypeId,
            ratePlanId: deluxe.ratePlanId,
            name: 'Asha Verma',
            mobile: '9829012345',
            challenge: first.challenge.token,
            answer,
            ...body,
          },
        });
      expect((await send({}, x + y + 1)).statusCode).toBe(400);
      expect((await send({ website: 'spam.example' })).json()).toEqual({ ok: true, number: null });
      // A corporate plan is not for the public page.
      const corp = await post(w.api, '/api/hotel/plans', {
        branchId: h.branchId,
        code: 'ACME',
        name: 'Acme rate',
        kind: 'CORPORATE',
        partyId: h.acme,
        rates: [{ roomTypeId: h.types.deluxe, base: 3000_00 }],
        weekendDays: [],
      });
      expect((await send({ ratePlanId: corp.id })).statusCode).toBe(400);
      const made = await send();
      expect(made.statusCode).toBe(200);
      expect(made.json()).toMatchObject({ ok: true, total: 8000_00, nights: 2 });
      const stay = await ctx.prisma.stay.findFirstOrThrow({
        where: { companyId: w.companyId, number: (made.json() as { number: string }).number },
      });
      expect(stay).toMatchObject({
        source: 'WEBSITE',
        status: 'BOOKED',
        arrive: h.d(2),
        depart: h.d(4),
        createdById: null,
      });
      // Switched off again: the page is gone.
      await ok(w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, { online: false }));
      expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    });

    it('X9, X10: a payment link for a table deposit — the gateway’s webhook records the money once and confirms the booking', async () => {
      const w = await world(ctx.app);
      const h = await hostDesk(ctx.prisma, w);
      const steward = await actor(ctx.prisma, w.companyId, h.r.steward.id);
      await ok(
        w.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, {
          depositFrom: 6,
          depositPerHeadPaise: 100_00,
        }),
      );
      const b = await h.reserve({ partySize: 6, guest: { name: 'Rohit Bansal', mobile: '9829066666' } });
      const g = gateway();
      // No gateway yet: said plainly.
      await expect(
        createPayLink(ctx.prisma, g.net, steward, { purpose: 'RESERVATION_DEPOSIT', refId: b.id }),
      ).rejects.toMatchObject({ status: 409 });
      const conn = await razorpay(w);
      const link = (await createPayLink(ctx.prisma, g.net, steward, {
        purpose: 'RESERVATION_DEPOSIT',
        refId: b.id,
      })) as Link;
      expect(link).toMatchObject({ url: 'https://rzp.io/i/abc', amount: 600_00, status: 'CREATED' });
      const call = g.calls[0]!;
      expect(call.url).toBe('https://api.razorpay.com/v1/payment_links');
      expect(call.headers.authorization).toBe(
        `Basic ${Buffer.from('rzp_test_1:rzp-secret').toString('base64')}`,
      );
      const reference = await referenceOf(link.id);
      expect(call.body).toMatchObject({
        amount: 600_00,
        currency: 'INR',
        reference_id: reference,
        customer: { name: 'Rohit Bansal', contact: '+919829066666' },
      });
      // Asked again while it waits: the same link, no second one at the gateway.
      expect(
        await createPayLink(ctx.prisma, g.net, steward, { purpose: 'RESERVATION_DEPOSIT', refId: b.id }),
      ).toMatchObject({
        id: link.id,
      });
      expect(g.calls).toHaveLength(1);

      const token = conn.hookPath.split('/').pop()!;
      const raw = paidBody(reference, 600_00);
      const hook = (body: string, signature: string) =>
        ctx.app.inject({
          method: 'POST',
          url: conn.hookPath,
          payload: body,
          headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
        });
      // A wrong signature is refused and nothing is recorded.
      expect((await hook(raw, sign(raw, 'someone-else'))).statusCode).toBe(401);
      expect((await hook(raw.replace('60000', '1'), sign(raw))).statusCode).toBe(401);
      const res = () => ok<ResOut>(h.r.steward.api.get(`/api/reservations/${b.id}`));
      expect(await res()).toMatchObject({ status: 'REQUESTED', deposit: { state: 'DUE' } });
      // Another event of the gateway is ignored.
      const other = JSON.stringify({ event: 'payment.captured', payload: {} });
      expect((await hook(other, sign(other))).json()).toMatchObject({ ignored: true });
      // The real one: an advance in the guest's name under "Payment gateway", and the booking is confirmed.
      expect((await hook(raw, sign(raw))).json()).toMatchObject({ recorded: true });
      const after = await res();
      expect(after).toMatchObject({ status: 'CONFIRMED', deposit: { state: 'PAID' } });
      const advance = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: after.deposit!.billId! } });
      expect(advance).toMatchObject({ type: 'ADVANCE', total: 600_00n, reference: 'pay_001' });
      const mode = await ctx.prisma.paymentMode.findUniqueOrThrow({ where: { id: advance.modeId! } });
      expect(mode.name).toBe('Payment gateway');
      // The gateway sends it twice: recorded once.
      expect(
        await gatewayWebhook(ctx.prisma, g.net, token, raw, { 'x-razorpay-signature': sign(raw) }),
      ).toMatchObject({
        again: true,
      });
      expect(await ctx.prisma.bill.count({ where: { companyId: w.companyId, type: 'ADVANCE' } })).toBe(1);

      // A second booking: the guest pays a different amount than the link asked — kept for a person, not recorded.
      const b2 = await h.reserve({
        partySize: 6,
        startMin: 21 * 60 + 30,
        guest: { name: 'Meena Jain', mobile: '9829077777' },
      });
      const link2 = (await createPayLink(ctx.prisma, g.net, steward, {
        purpose: 'RESERVATION_DEPOSIT',
        refId: b2.id,
      })) as Link;
      const short = paidBody(await referenceOf(link2.id), 100_00, 'pay_002');
      expect((await hook(short, sign(short))).json()).toMatchObject({ mismatch: true });
      expect(await ok<ResOut>(h.r.steward.api.get(`/api/reservations/${b2.id}`))).toMatchObject({
        status: 'REQUESTED',
      });
      const health = await integrationHealth(ctx.prisma, await actor(ctx.prisma, w.companyId, w.owner.id));
      expect(health.ok).toBe(false);
      expect(health.payments[0]!.note).toContain('pay_002');
      // A link that was cancelled is not paid into.
      await ok(h.r.steward.api.post(`/api/connect/paylinks/${link2.id}/cancel`));
      const full = paidBody(await referenceOf(link2.id), 600_00, 'pay_003');
      expect((await hook(full, sign(full))).json()).toMatchObject({ again: false });
      expect(await ctx.prisma.bill.count({ where: { companyId: w.companyId, type: 'ADVANCE' } })).toBe(1);
    });

    it('X11: links for a stay’s advance, a banquet’s advance and a restaurant bill (Cashfree’s signature)', async () => {
      const g = gateway();
      let n = 0;
      /** A company with Cashfree connected, and the gateway saying a link of it was paid. */
      const cashfree = async (w: World, modeId?: string) => {
        const conn = await ok<{ hookPath: string }>(
          w.api.put('/api/connect/connections', {
            kind: 'GATEWAY',
            provider: 'CASHFREE',
            secret: { clientId: 'cf-id', clientSecret: 'cf-secret' },
            modeId,
          }),
        );
        const token = conn.hookPath.split('/').pop()!;
        const paid = async (linkId: string, rupees: number) => {
          const raw = JSON.stringify({
            type: 'PAYMENT_LINK_EVENT',
            data: {
              link_id: await referenceOf(linkId),
              link_status: 'PAID',
              link_amount_paid: rupees,
              order: { transaction_id: `cf_txn_${++n}` },
            },
          });
          const ts = String(Date.now());
          const signature = createHmac('sha256', 'cf-secret')
            .update(ts + raw)
            .digest('base64');
          return gatewayWebhook(ctx.prisma, g.net, token, raw, {
            'x-webhook-timestamp': ts,
            'x-webhook-signature': signature,
          });
        };
        return { token, paid };
      };
      const w = await world(ctx.app);
      const h = await property(ctx.prisma, w);
      const steward = await actor(ctx.prisma, w.companyId, h.r.steward.id);
      const { token, paid } = await cashfree(w, h.r.modes.upi);
      // A stay's advance: the amount is typed.
      const s = await h.booked();
      await expect(
        createPayLink(ctx.prisma, g.net, steward, { purpose: 'STAY_ADVANCE', refId: s.id }),
      ).rejects.toMatchObject({ status: 400 });
      const l1 = (await createPayLink(ctx.prisma, g.net, steward, {
        purpose: 'STAY_ADVANCE',
        refId: s.id,
        amount: 3000_00,
      })) as Link;
      expect(g.calls[0]).toMatchObject({
        url: 'https://api.cashfree.com/pg/links',
        body: { link_amount: 3000, link_currency: 'INR' },
      });
      expect(g.calls[0]!.headers['x-client-secret']).toBe('cf-secret');
      expect(l1.url).toBe('https://payments.cashfree.com/links/xyz');
      // A bad signature first.
      await expect(
        gatewayWebhook(ctx.prisma, g.net, token, '{}', {
          'x-webhook-timestamp': '1',
          'x-webhook-signature': 'nope',
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(await paid(l1.id, 3000)).toMatchObject({ recorded: true });
      const folio = (await h.stay(s.id)).folios[0]!;
      expect(folio).toMatchObject({ paid: 3000_00 });
      // The money is booked under the mode the connection names (UPI), with the gateway's payment id.
      const adv = await ctx.prisma.bill.findFirstOrThrow({
        where: { companyId: w.companyId, type: 'ADVANCE' },
      });
      expect(adv).toMatchObject({ modeId: h.r.modes.upi, reference: 'cf_txn_1' });

      // A restaurant bill: what is due on it, and the bill is paid.
      const o = await open(h.r.steward.api, h.r, 'T1');
      await add(h.r.steward.api, o.id, [{ menuItemId: h.r.m.dal, qty: 1 }]);
      const c = await bill(h.r.steward.api, o.id);
      const l2 = (await createPayLink(ctx.prisma, g.net, steward, {
        purpose: 'POS_CHECK',
        refId: c.id,
      })) as Link;
      expect(l2.amount).toBe(c.total);
      expect(await paid(l2.id, c.total / 100)).toMatchObject({ recorded: true });
      expect(await ctx.prisma.posCheck.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
        status: 'PAID',
      });
      expect(await ctx.prisma.posOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
        status: 'PAID',
      });

      expect(
        (await ctx.prisma.payLink.findMany({ where: { companyId: w.companyId } })).every(
          (l) => l.status === 'PAID',
        ),
      ).toBe(true);

      // A banquet's advance on a quotation (another company, the same gateway): paid, the event can be confirmed.
      const w2 = await world(ctx.app);
      const bq = await banquets(ctx.prisma, w2);
      const cf2 = await cashfree(w2);
      const sales = await actor(ctx.prisma, w2.companyId, bq.r.steward.id);
      const e = await bq.quoted();
      const l3 = (await createPayLink(ctx.prisma, g.net, sales, {
        purpose: 'BANQUET_ADVANCE',
        refId: e.id,
        amount: 29625_00,
      })) as Link;
      expect(await cf2.paid(l3.id, 29625)).toMatchObject({ recorded: true });
      expect(await ok<EventOut>(bq.act(e.id, 'confirm'))).toMatchObject({ status: 'CONFIRMED' });
    });

    it('X12: the printed bill carries a QR code of the UPI pay link for its amount', async () => {
      const w = await world(ctx.app);
      const h = await hostDesk(ctx.prisma, w);
      const s = h.r.steward.api;
      const o = await open(s, h.r, 'T2');
      await add(s, o.id, [{ menuItemId: h.r.m.dal, qty: 1 }]);
      const c = await bill(s, o.id);
      const job = await ctx.prisma.printJob.findFirstOrThrow({
        where: { companyId: w.companyId, kind: 'BILL' },
      });
      const bytes = Buffer.from(job.payload, 'base64');
      const text = bytes.toString('latin1');
      expect(text).toContain('Scan to pay by UPI');
      // The printer's own QR command (GS ( k … 1 P 0) holding the link, then the print command (GS ( k … 1 Q 0).
      const link = c.upi!;
      expect(link).toContain(`am=${(c.total / 100).toFixed(2)}`);
      const store = bytes.indexOf(
        Buffer.concat([Buffer.from([0x31, 0x50, 0x30]), Buffer.from(link, 'latin1')]),
      );
      expect(store).toBeGreaterThan(0);
      const len = link.length + 3;
      expect([...bytes.subarray(store - 5, store)]).toEqual([0x1d, 0x28, 0x6b, len & 0xff, len >> 8]);
      expect(bytes.indexOf(Buffer.from([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]))).toBeGreaterThan(store);
    });
  },
);
