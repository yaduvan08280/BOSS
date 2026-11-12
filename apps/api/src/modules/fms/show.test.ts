import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flowFieldMap } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { doStep, master, publish, row, start, stranger, task, team, type Api } from '../forms/test-kit';
import { paperTexts } from './documents';
import { recordVars } from './show';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/** A booking process: an outlet picked from a master, a remembered venue, a formula, and a step with a value. */
async function bookings(api: Api, ownerId: string, paper = false) {
  const outlets = await master(api, 'Outlets', [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'city', label: 'City', type: 'text' },
    { key: 'cover_charge', label: 'Cover charge', type: 'number' },
    { key: 'opened_on', label: 'Opened on', type: 'date' },
  ]);
  const rooftop = await row(api, outlets, {
    name: 'Rooftop',
    city: 'Jaipur',
    cover_charge: 500,
    opened_on: '2024-04-01',
  });
  const garden = await row(api, outlets, { name: 'Garden', city: 'Ajmer', cover_charge: '1,250' });
  const startFields = [
    { key: 'guest', label: 'Guest', type: 'text', required: true },
    { key: 'outlet', label: 'Outlet', type: 'master', master: `m:${outlets}` },
    { key: 'venue', label: 'Venue', type: 'text', learn: true },
    { key: 'guests', label: 'Guests', type: 'number' },
    { key: 'rate', label: 'Rate', type: 'amount' },
    { key: 'total', label: 'Total', type: 'formula', formula: 'guests * rate' },
    { key: 'on', label: 'On', type: 'date' },
  ];
  const confirm = task('confirm', ownerId, [{ key: 'advance', label: 'Advance', type: 'amount' }]);
  const steps = [paper ? { ...confirm, documents: ['BKG'] } : confirm, task('serve', ownerId)];
  const flowId = await publish(api, 'Bookings', { startFields, steps });
  const book = async (
    guest: string,
    outlet: { id: string; label: string } | null,
    guests: number,
    rate: number,
  ) =>
    (
      await start(api, flowId, {
        guest,
        venue: 'Poolside',
        guests,
        rate,
        on: '2026-12-14',
        ...(outlet ? { outlet: outlet.label, _refs: { outlet: `row:${outlet.id}` } } : {}),
      })
    ).body as { id: string };
  return { flowId, outlets, rooftop, garden, book, startFields, steps };
}

describe('showing values anywhere (plan §2.5)', () => {
  it('L18: Live FMS shows chosen columns — a linked column (live through the link), a remembered value, a formula', async () => {
    const t = await team(ctx);
    const b = await bookings(t.api, t.owner.id);
    const sharma = await b.book('Sharma wedding', b.rooftop, 120, 1500.5);
    const verma = await b.book('Verma party', b.garden, 20, 800);
    const walkIn = await b.book('Walk-in', null, 2, 300);
    expect((await doStep(t.api, verma.id, { advance: 5000 })).status).toBe(200);

    // What the process offers: its fields, and the columns of the row a field links to.
    const paths = (await t.api.get(`/api/fms/flows/${b.flowId}/paths`)).body as {
      path: string;
      label: string;
    }[];
    expect(paths.map((p) => p.path)).toEqual(
      expect.arrayContaining([
        'guest',
        'outlet',
        'outlet.city',
        'outlet.cover_charge',
        'venue',
        'total',
        'advance',
      ]),
    );
    expect(paths.find((p) => p.path === 'outlet.city')).toMatchObject({
      label: 'Outlet → City',
      kpi: 'start:outlet.city',
    });

    const set = (columns: string[], api = t.api) =>
      api.put(`/api/fms/flows/${b.flowId}/live-columns`, { columns });
    expect((await set(['outlet.city', 'outlet.opened_on', 'venue', 'total', 'advance', 'on'])).status).toBe(
      200,
    );
    const live = (await t.api.get(`/api/fms/live?flowId=${b.flowId}`)).body;
    expect(live.columns).toEqual([
      { path: 'outlet.city', label: 'Outlet → City' },
      { path: 'outlet.opened_on', label: 'Outlet → Opened on' },
      { path: 'venue', label: 'Venue' },
      { path: 'total', label: 'Total' },
      { path: 'advance', label: 'Advance' },
      { path: 'on', label: 'On' },
    ]);
    const cols = (id: string, list = live) => list.records.find((r: { id: string }) => r.id === id).cols;
    expect(cols(sharma.id)).toEqual({
      'outlet.city': 'Jaipur',
      'outlet.opened_on': '01/04/2024',
      venue: 'Poolside',
      total: '1,80,060',
      on: '14/12/2026',
    });
    // A value entered on a finished step shows too; a record with no link has no linked column.
    expect(cols(verma.id)).toMatchObject({ 'outlet.city': 'Ajmer', total: '16,000', advance: '₹5,000' });
    expect(cols(walkIn.id)).toEqual({ venue: 'Poolside', total: '600', on: '14/12/2026' });

    // The outlet moves city: the list follows the row as it is today; a deleted row reads as empty.
    await t.api.put(`/api/masters/${b.outlets}/rows/${b.rooftop.id}`, { name: 'Rooftop', city: 'Udaipur' });
    await t.api.del(`/api/masters/${b.outlets}/rows/${b.garden.id}`);
    const after = (await t.api.get(`/api/fms/live?flowId=${b.flowId}`)).body;
    expect(cols(sharma.id, after)['outlet.city']).toBe('Udaipur');
    expect(cols(verma.id, after)['outlet.city']).toBeUndefined();

    // Only values of this process, at most six, and only by people who build processes.
    expect((await set(['nope'])).status).toBe(400);
    expect((await set(['outlet.rent'])).status).toBe(400);
    expect((await set(['guest', 'outlet', 'venue', 'guests', 'rate', 'total', 'on'])).status).toBe(400);
    expect((await set(['guest'], t.member.api)).status).toBe(403);
    const other = await stranger(ctx);
    expect((await set(['guest'], other.api)).status).toBe(404);
    expect((await other.api.get(`/api/fms/flows/${b.flowId}/paths`)).status).toBe(404);
  });

  it('L18: KPI cards total a formula, read a number from a linked row, and count', async () => {
    const t = await team(ctx);
    const b = await bookings(t.api, t.owner.id);
    await b.book('Sharma wedding', b.rooftop, 120, 1500.5);
    const verma = await b.book('Verma party', b.garden, 20, 800);
    await b.book('Walk-in', null, 2, 300);
    expect((await doStep(t.api, verma.id, { advance: 5000 })).status).toBe(200);
    const saved = await t.api.put(`/api/fms/flows/${b.flowId}/kpis`, [
      { label: 'Bookings', source: 'count', aggregation: 'COUNT', period: 'MONTH' },
      { label: 'Booked value', source: 'start:total', aggregation: 'TOTAL', period: 'MONTH' },
      {
        label: 'Average cover charge',
        source: 'start:outlet.cover_charge',
        aggregation: 'AVERAGE',
        period: 'MONTH',
      },
      { label: 'With an outlet', source: 'start:outlet.city', aggregation: 'COUNT', period: 'MONTH' },
      { label: 'Advance taken', source: 'step:confirm:advance', aggregation: 'TOTAL', period: 'MONTH' },
    ]);
    expect(saved.status).toBe(200);
    const cards = (await t.api.get(`/api/fms/flows/${b.flowId}/kpis`)).body as {
      label: string;
      value: number;
    }[];
    expect(Object.fromEntries(cards.map((c) => [c.label, c.value]))).toEqual({
      Bookings: 3,
      'Booked value': 180060 + 16000 + 600,
      'Average cover charge': (500 + 1250) / 2, // "1,250" typed in the master counts as a number
      'With an outlet': 2,
      'Advance taken': 5000,
    });
    expect(
      (
        await t.api.put(`/api/fms/flows/${b.flowId}/kpis`, [
          { label: 'Bad', source: 'start:a.b.c', aggregation: 'TOTAL', period: 'MONTH' },
        ])
      ).status,
    ).toBe(400);
  });

  it("L18: a paper and a message name the record's values and its linked row's columns", async () => {
    const t = await team(ctx);
    const type = await t.api.put('/api/document-types', {
      code: 'BKG',
      name: 'Booking note',
      prefix: 'BKG',
      header: 'Booking for {{guest}} at {{outlet}}, {{ outlet.city }} on {{on}}.',
      terms:
        'Total {{total}} for {{guests}} guests. Cover charge {{outlet.cover_charge}}. Ref {{number}} · {{company}}{{nothing}}',
      footer: null,
    });
    expect(type.status).toBe(200);
    const b = await bookings(t.api, t.owner.id, true);
    const sharma = await b.book('Sharma wedding', b.rooftop, 120, 1500.5);
    expect((await doStep(t.api, sharma.id, { advance: 20000 })).status).toBe(200);
    const doc = await ctx.prisma.document.findFirstOrThrow({
      where: { companyId: t.company.id, recordId: sharma.id },
      include: { type: true },
    });
    const company = await ctx.prisma.company.findUniqueOrThrow({ where: { id: t.company.id } });
    const fields = flowFieldMap({ startFields: b.startFields, steps: b.steps } as never);
    const texts = await paperTexts(ctx.prisma, doc, company, fields);
    expect(texts.header).toBe('Booking for Sharma wedding at Rooftop, Jaipur on 14/12/2026.');
    expect(texts.terms).toBe(
      `Total 1,80,060 for 120 guests. Cover charge 500. Ref ${doc.number} · ${company.legalName || company.name}`,
    );
    expect(texts.footer).toBe('');

    // What a message about this record can say: {{data.<field>}} and {{data.<field>.<column>}}.
    const vars = await recordVars(ctx.prisma, t.company.id, sharma.id, 'Asia/Kolkata');
    expect(vars).toMatchObject({
      'data.guest': 'Sharma wedding',
      'data.outlet': 'Rooftop',
      'data.outlet.name': 'Rooftop',
      'data.outlet.city': 'Jaipur',
      'data.outlet.cover_charge': '500',
      'data.total': '1,80,060',
      'data.rate': '₹1,500.5',
      'data.on': '14/12/2026',
      'data.advance': '₹20,000',
    });
    // Another company can't read this record's values, whatever id it names.
    const elsewhere = await ctx.prisma.company.findFirstOrThrow({ where: { id: { not: t.company.id } } });
    expect(await recordVars(ctx.prisma, elsewhere.id, sharma.id, 'Asia/Kolkata')).toEqual({});
  });
});
