import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '@mono/shared';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const TZ = 'Asia/Kolkata';
const today = () => localDate(new Date(), TZ);
const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const CR = 1_00_00_000_00;
const sum = (xs: (string | number)[]) => xs.reduce<number>((a, b) => a + Number(b), 0);

/** Owner, a CRM person, a CRR SC and an NBD SC (members), with seats and a short after-order flow. */
async function sales() {
  const o = await ownerClient(ctx.app);
  const make = async (name: string) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
    const api = await signedIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: `${name.split(' ')[0]}12345`,
    });
    return { id: r.person.id as string, api };
  };
  const crm = await make('Kiran Desk');
  const sc = await make('Sunita Bansal');
  const nbd = await make('Rohit Mittal');
  const ownerId = (
    await ctx.prisma.user.findFirstOrThrow({ where: { companyId: o.company.id, role: { key: 'OWNER' } } })
  ).id;
  await o.api.put('/api/crm/setup', {
    page: 'seats',
    patch: { seats: { owner: [ownerId], crm: [crm.id], crrSc: [sc.id], nbdSc: [nbd.id] } },
  });
  const flow = await o.api.put('/api/crm/setup', {
    page: 'afterOrder',
    patch: {
      afterOrder: [
        {
          key: 'confirm',
          name: 'Confirm order',
          seat: 'crm',
          time: { value: 2, unit: 'hours', anchor: 'start' },
          documents: ['Order confirmation'],
          proof: false,
        },
        {
          key: 'dispatch',
          name: 'Dispatch / delivery',
          seat: 'crm',
          time: { value: 0, unit: 'days', anchor: 'promised' },
          documents: [],
          proof: false,
        },
        {
          key: 'received',
          name: 'Payment received',
          seat: 'crm',
          time: { value: 0, unit: 'days', anchor: 'paymentDue' },
          documents: [],
          proof: false,
        },
      ],
    },
  });
  return {
    ...o,
    companyId: o.company.id,
    ownerId,
    crm,
    sc,
    nbd,
    flowId: flow.body.afterOrderFlowId as string,
  };
}

/** A customer with orders every `gap` days, the last `lastAgo` days ago. */
async function customerWithHistory(
  s: Awaited<ReturnType<typeof sales>>,
  name: string,
  gap: number,
  n: number,
  lastAgo: number,
  amount = 10_000_00,
) {
  const c = (
    await s.api.post('/api/crm/customers', {
      name,
      city: 'Ajmer',
      mobile: '9829012345',
      segment: 'dealer',
      handledById: s.sc.id,
      creditDays: 30,
    })
  ).body as { id: string };
  const t = today();
  await ctx.prisma.salesOrder.createMany({
    data: Array.from({ length: n }, (_, i) => {
      const d = addDays(t, -lastAgo - (n - 1 - i) * gap);
      return {
        companyId: s.companyId,
        number: `OLD/${name}/${i}`,
        customerId: c.id,
        orderDate: d,
        dueOn: addDays(d, 30),
        amount: BigInt(amount),
        gp: BigInt(amount / 5),
        items: [{ item: 'Valves', qty: 10, rate: 1000 }],
        status: 'DONE',
      };
    }),
  });
  return c.id;
}

describe('the year plan', () => {
  it('adds up to the rupee; months edited by hand; sent, approved by the owner, unlocked', async () => {
    const s = await sales();
    expect((await s.sc.api.put('/api/crm/plan', { input: { lastTurnover: 5 * CR } })).status).toBe(403);
    const p = (
      await s.api.put('/api/crm/plan', {
        input: {
          lastTurnover: 5 * CR,
          lastGp: CR,
          growthPct: 50,
          quarterGrowthPct: [0, 10, 10, 5],
          roundUnit: 1_000_000,
        },
      })
    ).body;
    expect(p.view.year.turnover).toBe(7.5 * CR);
    expect(p.view.addsUp).toBe(true);
    expect(sum(p.view.months.map((m: { turnover: number }) => m.turnover))).toBe(7.5 * CR);
    for (const m of p.view.months)
      expect(sum(m.weeks.map((w: { turnover: number }) => w.turnover))).toBe(m.turnover);
    // Seats: CRR half for Sunita, NBD half for Rohit.
    expect(p.seats.rows.map((r: { name: string; year: number }) => [r.name, r.year])).toEqual([
      ['Sunita Bansal', 3.75 * CR],
      ['Rohit Mittal', 3.75 * CR],
    ]);
    // "Change October 2026": keep the year total.
    const oct = p.view.months.findIndex((m: { month: string }) => m.month.endsWith('-10'));
    const kept = (
      await s.api.post('/api/crm/plan/month', { index: oct, turnover: 95 * 1_00_000_00, keepTotal: true })
    ).body;
    expect(kept.view.months[oct].turnover).toBe(95 * 1_00_000_00);
    expect(kept.view.year.turnover).toBe(7.5 * CR);
    expect(kept.view.addsUp).toBe(true);
    // Changing the year now needs the months worked out again.
    const clash = await s.api.put('/api/crm/plan', { input: { growthPct: 60 } });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('MONTHS_EDITED');
    // Approval: the owner approves; nobody edits an approved plan until it is unlocked.
    expect((await s.api.post('/api/crm/plan/submit', {})).body.status).toBe('PENDING');
    expect((await s.api.put('/api/crm/plan', { input: { growthPct: 60 }, resetMonths: true })).status).toBe(
      409,
    );
    expect((await s.sc.api.post('/api/crm/plan/approve', {})).status).toBe(403);
    expect((await s.api.post('/api/crm/plan/approve', {})).body.status).toBe('APPROVED');
    expect((await s.api.post('/api/crm/plan/unlock', {})).body.status).toBe('DRAFT');
    expect(
      (await s.api.put('/api/crm/plan', { input: { growthPct: 60 }, resetMonths: true })).body.view.year
        .turnover,
    ).toBe(8 * CR);
  });
});

describe('SCOT, calls and orders', () => {
  it('schedules the call from order history; an order taken runs through the after-order steps to done', async () => {
    const s = await sales();
    // Every 20 days, last one 17 days ago → due in 3 days → call (5 days before) was 2 days ago.
    const ram = await customerWithHistory(s, 'Ram Traders', 20, 6, 17);
    // Ordered 3 days ago: nothing to call about yet.
    await customerWithHistory(s, 'Shyam Tiles', 20, 4, 3);
    const scot = (await s.api.get('/api/crm/scot')).body;
    const row = scot.rows.find((r: { customerId: string }) => r.customerId === ram);
    expect(row).toMatchObject({
      everyDays: 20,
      rhythm: 'fortnightly',
      lastOrder: addDays(today(), -17),
      nextDue: addDays(today(), 3),
      callOn: addDays(today(), -2),
      averageOrder: '1000000',
      overdue: true,
    });
    expect(scot.tiles).toMatchObject({ onScot: 2, overdue: 1 });

    // Sunita sees her call for Ram (only Ram's is due).
    const calls = (await s.sc.api.get('/api/crm/calls')).body;
    expect(calls.calls.map((c: { customer: { name: string } }) => c.customer.name)).toEqual(['Ram Traders']);
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: s.companyId, name: 'crm.call_due' } }),
    ).toBe(1);
    const callId = calls.calls[0].id;
    // A result needs what it needs.
    expect((await s.sc.api.post(`/api/crm/calls/${callId}/answer`, { result: 'LOST' })).status).toBe(400);
    const taken = (
      await s.sc.api.post(`/api/crm/calls/${callId}/answer`, {
        result: 'ORDER',
        order: {
          amount: 12_000_00,
          items: [{ item: 'Valves', qty: 12, rate: 1000_00 }],
          promisedOn: addDays(today(), 2),
        },
      })
    ).body;
    expect(taken.order.number).toMatch(/^SO\/\d{2}-\d{2}\/0001$/);
    // Answered once only; no new call until the next cycle.
    expect((await s.sc.api.post(`/api/crm/calls/${callId}/answer`, { result: 'NOT_NOW' })).status).toBe(409);

    // CRM Orders: the order sits on its first step, done by the CRM person.
    let board = (await s.api.get('/api/crm/orders')).body;
    const card = board.columns[0].cards[0];
    expect(card).toMatchObject({
      number: taken.order.number,
      customer: 'Ram Traders',
      amount: '1200000',
      step: { key: 'confirm', doer: 'Kiran Desk' },
    });
    expect((await s.crm.api.post(`/api/fms/steps/${card.step.id}/complete`, {})).status).toBe(400); // checklist
    await s.crm.api.post(`/api/fms/steps/${card.step.id}/complete`, {
      checklistDone: ['Order confirmation'],
    });
    board = (await s.api.get('/api/crm/orders')).body;
    const next = board.columns[1].cards[0];
    expect(next.step.key).toBe('dispatch');
    await s.crm.api.post(`/api/fms/steps/${next.step.id}/complete`, {});
    board = (await s.api.get('/api/crm/orders')).body;
    await s.crm.api.post(`/api/fms/steps/${board.columns[2].cards[0].step.id}/complete`, {});
    board = (await s.api.get('/api/crm/orders')).body;
    expect(board.columns.every((c: { cards: unknown[] }) => !c.cards.length)).toBe(true);
    expect((await ctx.prisma.salesOrder.findUniqueOrThrow({ where: { id: taken.order.id } })).status).toBe(
      'DONE',
    );
  });

  it('collections: owed by age; a payment can’t be more than owed; statements go to the customer', async () => {
    const s = await sales();
    const c = await customerWithHistory(s, 'Mohan Marbles', 30, 2, 50, 5_00_000_00);
    const col = (await s.api.get('/api/crm/collections')).body;
    const row = col.rows.find((r: { customerId: string }) => r.customerId === c);
    // Two orders of ₹5 L: one due 50 days ago (31–60), one 20 days ago (0–30).
    expect(row).toMatchObject({
      receivable: '100000000',
      overdue: '100000000',
      ageing: { '0_30': '50000000', '31_60': '50000000' },
    });
    expect(
      (await s.api.post('/api/crm/payments', { customerId: c, amount: 2_00_00_000_00, date: today() }))
        .status,
    ).toBe(409);
    await s.api.post('/api/crm/payments', { customerId: c, amount: 5_00_000_00, date: today(), mode: 'upi' });
    const after = (await s.api.get('/api/crm/collections')).body.rows.find(
      (r: { customerId: string }) => r.customerId === c,
    );
    // Paid against the oldest order first.
    expect(after.ageing).toMatchObject({ '0_30': '50000000', '31_60': '0' });
    await s.api.post('/api/crm/collections/notes', {
      customerId: c,
      note: 'Will pay after Diwali',
      promisedOn: addDays(today(), 5),
    });
    expect((await s.api.post(`/api/crm/collections/${c}/statement`, {})).body.sent).toBe(true);
    const ev = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { companyId: s.companyId, name: 'crm.payment_due' },
    });
    expect(ev.payload).toMatchObject({
      customer: 'Mohan Marbles',
      customerMobile: '9829012345',
      amount: '₹5,00,000.00',
    });
  });

  it('a quiet customer is sleeping and gets a win-back call; lost on a call goes to win-back', async () => {
    const s = await sales();
    const old = await customerWithHistory(s, 'Gupta Stones', 25, 3, 75);
    const list = (await s.api.get('/api/crm/customers')).body;
    expect(list.customers.find((c: { id: string }) => c.id === old).autoTags).toContain('sleeping');
    const calls = (await s.api.get('/api/crm/calls')).body;
    const wb = calls.calls.find((c: { customer: { id: string } }) => c.customer.id === old);
    expect(wb.kind).toBe('winback');
    await s.api.post(`/api/crm/calls/${wb.id}/answer`, {
      result: 'LOST',
      lostReason: 'Bought a cheaper brand',
    });
    expect(
      (await s.api.get('/api/crm/customers')).body.customers.find((c: { id: string }) => c.id === old)
        .autoTags,
    ).toContain('lost');
  });
});

describe('NBD funnel', () => {
  it('an enquiry is qualified (all yes), moves stages with a next action, and is won as a customer', async () => {
    const s = await sales();
    const e = (
      await s.api.post('/api/crm/leads', {
        name: 'Anil Jain',
        company: 'Jain Builders',
        mobile: '9876543210',
        city: 'Jaipur',
        source: 'Website',
        requirement: 'Quartz for 40 flats',
        value: 25_00_000_00,
      })
    ).body;
    expect(
      (
        await s.api.post('/api/crm/leads', {
          name: 'X',
          mobile: '9876543210',
          city: 'Jaipur',
          source: 'Nowhere',
          requirement: 'abc',
        })
      ).status,
    ).toBe(400);
    const lead = await ctx.prisma.lead.findUniqueOrThrow({ where: { id: e.id } });
    expect(lead.ownerId).toBe(s.nbd.id);
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: s.companyId, name: 'crm.lead_assigned' } }),
    ).toBe(1);
    const next = { nextAction: 'Visit the site', nextActionOn: addDays(today(), 2) };
    expect(
      (
        await s.nbd.api.post(`/api/crm/leads/${e.id}/action`, {
          action: 'qualify',
          answers: { 'Need is confirmed?': true },
          ...next,
        })
      ).status,
    ).toBe(400);
    const q = await s.nbd.api.post(`/api/crm/leads/${e.id}/action`, {
      action: 'qualify',
      answers: { 'Talking to the person who decides?': true, 'Need is confirmed?': true },
      ...next,
    });
    expect(q.body.status).toBe('OPEN');
    expect(
      (await s.nbd.api.post(`/api/crm/leads/${e.id}/action`, { action: 'move', stage: 'meeting' })).status,
    ).toBe(400);
    await s.nbd.api.post(`/api/crm/leads/${e.id}/action`, { action: 'move', stage: 'meeting', ...next });
    const f = (await s.api.get('/api/crm/leads')).body;
    expect(f.columns.find((c: { key: string }) => c.key === 'meeting').leads[0]).toMatchObject({
      company: 'Jain Builders',
      value: '250000000',
      stuck: false,
    });
    // Someone else's lead: a member can't touch it.
    expect(
      (await s.sc.api.post(`/api/crm/leads/${e.id}/action`, { action: 'lose', reason: 'Testing' })).status,
    ).toBe(403);
    const won = (await s.nbd.api.post(`/api/crm/leads/${e.id}/action`, { action: 'win' })).body;
    const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: won.customerId } });
    expect(customer).toMatchObject({ name: 'Jain Builders', city: 'Jaipur', handledById: s.nbd.id });
    expect((await s.api.get('/api/crm/leads')).body.tiles).toMatchObject({ open: 0, winRatePct: 100 });
  });
});

describe('dashboard and MeCA', () => {
  it('this month’s target from the plan, achieved so far, and each seat’s week', async () => {
    const s = await sales();
    await s.api.put('/api/crm/plan', { input: { mode: 'exact', exactTurnover: 12 * CR } });
    const c = (await s.api.post('/api/crm/customers', { name: 'Delta Homes', creditDays: 15 })).body;
    await s.sc.api.post('/api/crm/orders', { customerId: c.id, amount: 3_00_000_00 });
    const d = (await s.api.get('/api/crm/dashboard')).body;
    expect(Number(d.month.target)).toBeGreaterThan(0);
    expect(d.month.achieved).toBe('30000000');
    expect(d.tiles.orders).toBe(1);
    // Sunita's own view: her CRR target and her order.
    const mine = (await s.sc.api.get('/api/crm/dashboard')).body;
    expect(mine.viewing.own).toBe(true);
    expect(Number(mine.month.target)).toBeLessThan(Number(d.month.target));
    const m = (await s.api.get('/api/crm/meca')).body;
    const sunita = m.rows.find((r: { name: string }) => r.name === 'Sunita Bansal');
    const week = sunita.weeks.find(
      (w: { start: string; end: string }) => w.start <= today() && w.end >= today(),
    );
    expect(week.orders.value).toBe('30000000');
  });
});
