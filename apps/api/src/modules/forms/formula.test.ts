import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let o: Awaited<ReturnType<typeof ownerClient>>;
beforeAll(async () => {
  ctx = await makeApp();
  o = await ownerClient(ctx.app);
});
afterAll(async () => ctx.app.close());

type Field = { key: string; label: string; type: string; formula?: string; required?: boolean };
const num = (key: string, type = 'number'): Field => ({ key, label: key, type });
const formula = (key: string, expr: string): Field => ({ key, label: key, type: 'formula', formula: expr });
const step = (key: string, fields: Field[] = []) => ({
  key,
  name: key,
  type: 'TASK',
  doerIds: [o.owner.id],
  time: { value: 2, unit: 'hours', anchor: 'previous' },
  fields,
});

let n = 0;
async function draft(startFields: Field[], steps = [step('only')]) {
  const flow = (await o.api.post('/api/fms/flows', { meta: { name: `Formulas ${++n}`, runName: 'Bill' } }))
    .body;
  const saved = await o.api.put(`/api/fms/flows/${flow.id}`, {
    definition: { timeModel: 'calendar', startFields, steps },
  });
  expect(saved.status).toBe(200);
  return flow.id as string;
}
async function published(startFields: Field[], steps = [step('only')]) {
  const id = await draft(startFields, steps);
  const res = await o.api.post(`/api/fms/flows/${id}/publish`);
  expect(res.body).toMatchObject({ status: 'PUBLISHED' });
  return id;
}
async function start(flowId: string, data: Record<string, unknown>) {
  const res = await o.api.post(`/api/fms/flows/${flowId}/records`, { data });
  expect(res.status).toBe(200);
  return (await o.api.get(`/api/fms/records/${res.body.id}`)).body;
}

describe('formula fields on the server', () => {
  it("L13: qty × rate is worked out on the server and the browser's value is ignored", async () => {
    const flow = await published([
      num('qty'),
      num('rate', 'amount'),
      formula('total', 'qty × rate'),
      formula('with_tax', 'total + 18%'),
    ]);
    const rec = await start(flow, { qty: 3, rate: '1,250.50', total: 1, with_tax: 99_99_999 });
    expect(rec.data).toMatchObject({ qty: 3, rate: 1250.5, total: 3751.5, with_tax: 4426.77 });

    // Only a formula's value sent, nothing to work it out from: nothing is stored.
    const empty = await start(flow, { total: 500, with_tax: 590 });
    expect(empty.data).not.toHaveProperty('total');
    expect(empty.data).not.toHaveProperty('with_tax');
    expect(empty.data).not.toHaveProperty('qty');
  });

  it('L13: nights between two dates, counted on the company calendar', async () => {
    const flow = await published([
      { key: 'checkin', label: 'Check-in', type: 'date' },
      { key: 'checkout', label: 'Check-out', type: 'date' },
      { key: 'arrived', label: 'Arrived', type: 'datetime' },
      { key: 'left', label: 'Left', type: 'datetime' },
      num('tariff', 'amount'),
      formula('nights', 'checkout − checkin'),
      formula('room', 'days(checkout, checkin) * tariff'),
      formula('stayed', 'days(left, arrived)'),
      formula('due_back', 'checkout + 7'),
    ]);
    const rec = await start(flow, {
      checkin: '2026-11-12',
      checkout: '2026-11-15',
      // 12/11 23:30 IST → 13/11 00:30 IST: one night in India, the same day in UTC.
      arrived: '2026-11-12T18:00:00.000Z',
      left: '2026-11-12T19:00:00.000Z',
      tariff: 3200,
    });
    expect(rec.data).toMatchObject({ nights: 3, room: 9600, stayed: 1, due_back: '2026-11-22' });
    // Check-out not known yet: no nights — not 0, and the form is not refused.
    const open = await start(flow, { checkin: '2026-11-12', tariff: 3200 });
    expect(open.data).not.toHaveProperty('nights');
    expect(open.data).not.toHaveProperty('room');
  });

  it('L13: the sum of item lines', async () => {
    const flow = await published([
      { key: 'lines', label: 'Items', type: 'items' },
      formula('goods', 'sum(lines)'),
      formula('pieces', "sum(lines, 'qty')"),
      formula('kinds', 'count(lines)'),
    ]);
    const rec = await start(flow, {
      lines: [
        { item: 'Paneer tikka', qty: 2, rate: 320, amount: 1 },
        { item: 'Masala chai', qty: 5, rate: 40.5 },
      ],
      goods: 5,
    });
    // The lines' amounts are the server's own (2 × 320, 5 × 40.5), and the sum is of those.
    expect(rec.data).toMatchObject({ goods: 842.5, pieces: 7, kinds: 2 });
  });

  it('L13: a percentage', async () => {
    const flow = await published([
      num('amount', 'amount'),
      num('discount'),
      formula('gst', 'amount * 18%'),
      formula('after_discount', 'amount − discount%'),
      formula('share', 'round(discount / amount * 100, 1)'),
      formula('payable', 'after_discount + gst'),
    ]);
    const rec = await start(flow, { amount: 2000, discount: 10 });
    expect(rec.data).toMatchObject({ gst: 360, after_discount: 1800, share: 0.5, payable: 2160 });
  });

  it('L13: a step formula reads start-form fields and earlier steps, never the browser', async () => {
    const flow = await published(
      [
        { key: 'checkin', label: 'Check-in', type: 'date' },
        { key: 'checkout', label: 'Check-out', type: 'date' },
        num('tariff', 'amount'),
        formula('room', 'days(checkout, checkin) * tariff'),
      ],
      [
        step('service', [
          { key: 'extras', label: 'Extras', type: 'items' },
          formula('extras_total', 'sum(extras)'),
        ]),
        step('bill', [
          num('advance', 'amount'),
          formula('gross', 'room + ifblank(extras_total, 0)'),
          formula('balance', 'gross + 12% − ifblank(advance, 0)'),
        ]),
      ],
    );
    const rec = await start(flow, { checkin: '2026-11-12', checkout: '2026-11-14', tariff: 2500, room: 1 });
    expect(rec.data.room).toBe(5000);
    const open = async () =>
      (await o.api.get(`/api/fms/records/${rec.id}`)).body.steps.find(
        (s: { status: string }) => s.status === 'OPEN',
      );
    const done = async (data: Record<string, unknown>) => {
      const res = await o.api.post(`/api/fms/steps/${(await open()).id}/complete`, { data });
      expect(res.status).toBe(200);
    };
    await done({ extras: [{ item: 'Laundry', qty: 2, rate: 150 }], extras_total: 9 });
    await done({ advance: 1000, gross: 1, balance: 1 });
    const steps = (await o.api.get(`/api/fms/records/${rec.id}`)).body.steps as {
      stepKey: string;
      data: Record<string, unknown>;
    }[];
    expect(steps.find((s) => s.stepKey === 'service')!.data).toMatchObject({ extras_total: 300 });
    // (5000 + 300) + 12% − 1000
    expect(steps.find((s) => s.stepKey === 'bill')!.data).toMatchObject({ gross: 5300, balance: 4936 });
  });

  it('L13: publishing a broken formula is refused, and the builder is told which field and why', async () => {
    const problems = async (id: string) => {
      const res = await o.api.post(`/api/fms/flows/${id}/publish`);
      expect(res.status).toBe(400);
      return (
        res.body.error.details.issues as { code: string; stepKey?: string; field?: string; detail?: string }[]
      )
        .filter((i) => i.code === 'formula')
        .map((i) => [i.stepKey ?? 'start', i.field, i.detail]);
    };
    // It can't be read.
    expect(await problems(await draft([num('qty'), formula('total', 'qty × ')]))).toEqual([
      ['start', 'total', 'total: Something is missing after "×".'],
    ]);
    // A field that isn't there, a field of the wrong type, no formula at all.
    expect(
      await problems(
        await draft([
          num('qty'),
          { key: 'photo', label: 'Photo', type: 'photo' },
          formula('a', 'qty * price'),
          formula('b', 'qty + photo'),
          { key: 'c', label: 'c', type: 'formula' },
        ]),
      ),
    ).toEqual([
      ['start', 'a', 'a: There is no field called "price" here. Pick a field from the list.'],
      ['start', 'b', expect.stringContaining('"Photo" can\'t be used in a formula')],
      ['start', 'c', expect.stringContaining('Write the formula')],
    ]);
    // Formulas that read each other, and one that reads itself.
    expect(
      (
        await problems(await draft([formula('a', 'b + 1'), formula('b', 'a + 1'), formula('me', 'me * 2')]))
      ).map((p) => p[1]),
    ).toEqual(['a', 'b', 'me']);
    // A step can't read a later step; the editor's own check shows the same problem before publishing.
    const late = await draft(
      [num('qty')],
      [step('one', [formula('early', 'qty * freight')]), step('two', [num('freight')])],
    );
    expect(await problems(late)).toEqual([['one', 'early', expect.stringContaining('"freight"')]]);
    const detail = (await o.api.get(`/api/fms/flows/${late}`)).body;
    expect(detail.issues).toMatchObject([{ code: 'formula', stepKey: 'one', field: 'early' }]);
    expect(detail.status).toBe('DRAFT');
    // Mend it and it publishes.
    await o.api.put(`/api/fms/flows/${late}`, {
      definition: {
        timeModel: 'calendar',
        startFields: [num('qty')],
        steps: [step('one', [num('freight')]), step('two', [formula('late', 'qty * freight')])],
      },
    });
    expect((await o.api.post(`/api/fms/flows/${late}/publish`)).body).toMatchObject({ status: 'PUBLISHED' });
  });

  it('L13: a formula that can not be worked out leaves its field empty and never fails the form', async () => {
    const flow = await published([
      num('qty'),
      num('rate'),
      formula('total', 'qty * rate'),
      formula('each', 'rate / qty'),
    ]);
    // Division by zero: no value for that one, the other is still worked out.
    const zero = await start(flow, { qty: 0, rate: 50 });
    expect(zero.data).toMatchObject({ qty: 0, rate: 50, total: 0 });
    expect(zero.data).not.toHaveProperty('each');
    // A version published before a formula went wrong (here: broken by hand in the database) still takes forms.
    const version = await ctx.prisma.flowVersion.findFirstOrThrow({ where: { flowId: flow } });
    const def = version.definition as { startFields: Field[] };
    def.startFields[2]!.formula = 'qty * * rate';
    def.startFields[3]!.formula = 'constructor.constructor("return process")()';
    await ctx.prisma.flowVersion.update({ where: { id: version.id }, data: { definition: def as object } });
    const rec = await start(flow, { qty: 2, rate: 50, total: 100, each: 25 });
    expect(rec.data).toEqual({ qty: 2, rate: 50 });
  });

  it('L13: a master row works out its formulas too', async () => {
    const master = (
      await o.api.post('/api/masters', {
        name: 'Room types',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          num('tariff', 'amount'),
          formula('with_gst', 'round(tariff + 12%)'),
        ],
        keyField: 'name',
      })
    ).body;
    const row = await o.api.post(`/api/masters/${master.id}/rows`, {
      name: 'Deluxe',
      tariff: 4505,
      with_gst: 1,
    });
    expect(row.status).toBe(200);
    const rows = (await o.api.get(`/api/masters/${master.id}/rows`)).body;
    expect(JSON.stringify(rows)).toContain('"with_gst":5046');
  });
});
