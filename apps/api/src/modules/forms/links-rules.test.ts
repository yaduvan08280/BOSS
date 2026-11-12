import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import {
  cancel,
  doStep,
  master,
  options,
  publish,
  republish,
  row,
  start,
  task,
  team,
  type Ctx,
} from './test-kit';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const text = (key: string, label: string, more: object = {}) => ({ key, label, type: 'text', ...more });
const fieldError = (
  r: { body: { error?: { details?: { fields?: Record<string, string> } } } },
  key: string,
) => r.body.error?.details?.fields?.[key];

describe('unique fields', () => {
  it('L10: a value already used in another live record is refused; cancelling that record frees it', async () => {
    const t = await team(ctx);
    const flow = await publish(t.api, 'Room booking', {
      startFields: [
        text('ref', 'Booking reference', { required: true, unique: true }),
        text('guest', 'Guest'),
      ],
      steps: [task('confirm', t.owner.id, [text('ref', 'Booking reference', { unique: true })])],
    });
    const first = await start(t.api, flow, { ref: 'BK-001', guest: 'Sharma' });
    expect(first.status).toBe(200);
    // The same value again — whatever the case or the spaces around it — is refused, and the field is named.
    const again = await start(t.member.api, flow, { ref: '  bk-001 ', guest: 'Gupta' });
    expect(again.status).toBe(400);
    expect(fieldError(again, 'ref')).toBe('Booking reference: "bk-001" is already used');
    expect((await start(t.api, flow, { ref: 'BK-002' })).status).toBe(200);

    // A record does not trip over its own value: the same field on its step may repeat it…
    expect((await doStep(t.api, first.body.id, { ref: 'bk-001' })).status).toBe(200);
    // …but may not take another record's.
    const third = (await start(t.api, flow, { ref: 'BK-003' })).body;
    expect(fieldError(await doStep(t.api, third.id, { ref: 'BK-002' }), 'ref')).toContain('already used');
    // Changing its own value gives the old one back.
    expect((await doStep(t.api, third.id, { ref: 'BK-003-A' })).status).toBe(200);
    expect((await start(t.api, flow, { ref: 'BK-003' })).status).toBe(200);

    // A closed record still holds its value (a bill number stays taken)…
    expect((await t.api.get(`/api/fms/records/${first.body.id}`)).body.status).toBe('CLOSED');
    expect((await start(t.api, flow, { ref: 'BK-001' })).status).toBe(400);
    // …a cancelled one gives it back.
    const second = await ctx.prisma.fmsRecord.findFirstOrThrow({
      where: { flowId: flow, data: { path: ['ref'], equals: 'BK-002' } },
    });
    expect((await cancel(t.api, second.id)).status).toBe(200);
    expect((await start(t.member.api, flow, { ref: 'BK-002' })).status).toBe(200);
    // Each process has its own values.
    const other = await publish(t.api, 'Hall booking', {
      startFields: [text('ref', 'Booking reference', { unique: true })],
      steps: [task('confirm', t.owner.id)],
    });
    expect((await start(t.api, other, { ref: 'BK-001' })).status).toBe(200);
  });

  it('L10: two people saving the same value at the same moment cannot both win', async () => {
    const t = await team(ctx);
    const flow = await publish(t.api, 'Bill', {
      startFields: [text('bill_no', 'Bill number', { required: true, unique: true })],
      steps: [task('print', t.owner.id)],
    });
    for (const no of ['B-1', 'B-2', 'B-3']) {
      const results = await Promise.all([
        start(t.api, flow, { bill_no: no }),
        start(t.member.api, flow, { bill_no: no.toLowerCase() }),
        start(t.api, flow, { bill_no: ` ${no} ` }),
      ]);
      expect(results.map((r) => r.status).sort(), no).toEqual([200, 400, 400]);
      expect(await ctx.prisma.fmsRecord.count({ where: { flowId: flow, status: 'RUNNING' } })).toBe(
        Number(no.slice(2)),
      );
    }
    // The loser's whole save is undone: no half-made record, no number used up twice.
    const numbers = (await ctx.prisma.fmsRecord.findMany({ where: { flowId: flow } })).map((r) => r.number);
    expect(numbers.sort()).toEqual([1, 2, 3]);
  });

  it('L10: values saved before the field became unique count too; master rows follow the same rule', async () => {
    const t = await team(ctx);
    const def = (unique: boolean) => ({
      startFields: [text('ref', 'Reference', unique ? { unique: true } : {})],
      steps: [task('do', t.owner.id)],
    });
    const flow = await publish(t.api, 'Gate pass', def(false));
    await start(t.api, flow, { ref: 'GP-7' });
    expect((await start(t.api, flow, { ref: 'GP-7' })).status).toBe(200); // not unique yet
    await republish(t.api, flow, def(true));
    expect((await start(t.api, flow, { ref: 'gp-7' })).status).toBe(400);
    expect((await start(t.api, flow, { ref: 'GP-8' })).status).toBe(200);

    const rooms = await master(t.api, 'Rooms', [
      text('name', 'Room', { required: true }),
      text('key_tag', 'Key tag', { unique: true }),
    ]);
    const r101 = await row(t.api, rooms, { name: '101', key_tag: 'K-17' });
    const clash = await t.api.post(`/api/masters/${rooms}/rows`, { name: '102', key_tag: 'k-17' });
    expect(clash.status).toBe(400);
    expect(fieldError(clash, 'key_tag')).toContain('already used');
    // Saving the row again with its own value is fine; deleting it frees the value.
    expect(
      (await t.api.put(`/api/masters/${rooms}/rows/${r101.id}`, { name: '101 A', key_tag: 'K-17' })).status,
    ).toBe(200);
    await t.api.del(`/api/masters/${rooms}/rows/${r101.id}`);
    expect((await t.api.post(`/api/masters/${rooms}/rows`, { name: '102', key_tag: 'K-17' })).status).toBe(
      200,
    );
  });
});

describe('auto-fill', () => {
  it('L11: picking an item fills unit and rate; a locked target cannot be overridden by the browser', async () => {
    const t = await team(ctx);
    const item = (
      await t.api.post('/api/ims/items', {
        code: 'CEM-01',
        name: 'Cement 50 kg',
        unit: 'bag',
        ratePaise: 45000,
      })
    ).body;
    const flow = await publish(t.api, 'Material issue', {
      startFields: [
        { key: 'item', label: 'Item', type: 'master', master: 'items', fill: { unit: 'unit', rate: 'rate' } },
        text('unit', 'Unit'),
        { key: 'rate', label: 'Rate', type: 'amount', locked: true, required: true },
        { key: 'qty', label: 'Quantity', type: 'number' },
      ],
      steps: [task('issue', t.owner.id)],
    });
    // What the form gets when the item is picked: its link and the columns to copy.
    const picked = (await options(t.api, { owner: `flow:${flow}`, field: 'item', q: 'cem' })).list[0]!;
    expect(picked).toMatchObject({ ref: `item:${item.id}`, columns: { unit: 'bag', rate: 450 } });
    const cols = (await t.api.get('/api/masters/columns?source=items')).body as { key: string }[];
    expect(cols.map((c) => c.key)).toEqual(expect.arrayContaining(['unit', 'rate']));

    // Filled fields stay editable: the unit the person changed is kept. The locked rate is the item's, whatever came.
    const rec = await start(t.api, flow, {
      item: picked.value,
      unit: 'box',
      rate: 1,
      qty: 4,
      _refs: { item: picked.ref },
    });
    expect(rec.body.data).toEqual({
      item: 'Cement 50 kg',
      unit: 'box',
      rate: 450,
      qty: 4,
      _refs: { item: `item:${item.id}` },
    });
    // Not sent at all: still filled from the item.
    const bare = await start(t.api, flow, { item: 'Cement 50 kg', _refs: { item: `item:${item.id}` } });
    expect(bare.body.data.rate).toBe(450);
    // Typed by hand (no link): a locked field has nothing to come from, so a typed rate is not taken.
    const typed = await start(t.api, flow, { item: 'Something else', rate: 99 });
    expect(typed.status).toBe(400);
    expect(fieldError(typed, 'rate')).toBe('Rate is required');
  });

  it('L11: picking a record fills its fields', async () => {
    const t = await team(ctx);
    const bookings = await publish(t.api, 'Room booking', {
      startFields: [
        text('guest', 'Guest', { required: true }),
        { key: 'mobile', label: 'Mobile', type: 'mobile' },
      ],
      steps: [task('confirm', t.owner.id, [{ key: 'checkin', label: 'Check-in', type: 'date' }])],
    });
    const booking = (await start(t.api, bookings, { guest: 'Meera Joshi', mobile: '98290 12345' })).body;
    await doStep(t.api, booking.id, { checkin: '2026-12-14' });
    const desk = await publish(t.api, 'Guest request', {
      startFields: [
        {
          key: 'booking',
          label: 'Booking',
          type: 'master',
          master: `rec:${bookings}`,
          fill: { guest: 'guest', mobile: 'mobile', checkin: 'checkin', booking_no: 'number' },
        },
        text('guest', 'Guest', { locked: true }),
        { key: 'mobile', label: 'Mobile', type: 'mobile', locked: true },
        { key: 'checkin', label: 'Check-in', type: 'date', locked: true },
        { key: 'booking_no', label: 'Booking no.', type: 'number', locked: true },
        text('request', 'Request'),
      ],
      steps: [task('do', t.owner.id)],
    });
    const rec = await start(t.api, desk, {
      booking: 'x',
      guest: 'Somebody Else',
      request: 'Extra pillow',
      _refs: { booking: `rec:${booking.id}` },
    });
    expect(rec.body.data).toMatchObject({
      guest: 'Meera Joshi',
      mobile: '+919829012345',
      checkin: '2026-12-14',
      booking_no: 1,
      request: 'Extra pillow',
    });
  });
});

describe('dependent choices', () => {
  async function outlets() {
    const t = await team(ctx);
    const outlet = await master(t.api, 'Outlets', [text('name', 'Outlet', { required: true })]);
    const tables = await master(t.api, 'Tables', [
      text('name', 'Table', { required: true }),
      { key: 'outlet', label: 'Outlet', type: 'master', master: `m:${outlet}` },
    ]);
    const rooftop = await row(t.api, outlet, { name: 'Rooftop' });
    await row(t.api, outlet, { name: 'Lobby' });
    const linked = { _refs: { outlet: `row:${rooftop.id}` } };
    const t1 = await row(t.api, tables, { name: 'T1', outlet: 'Rooftop', ...linked });
    await row(t.api, tables, { name: 'T2', outlet: 'rooftop ' }); // typed, not picked
    const t9 = await row(t.api, tables, { name: 'T9', outlet: 'Lobby' });
    const table = {
      key: 'table',
      label: 'Table',
      type: 'master',
      master: `m:${tables}`,
      filterBy: { field: 'outlet', column: 'outlet' },
    };
    const outletField = { key: 'outlet', label: 'Outlet', type: 'master', master: `m:${outlet}` };
    return { t, outlet, tables, rooftop, t1, t9, table, outletField };
  }

  it('L12: pick an Outlet → only its Tables are offered, and that is enforced on save', async () => {
    const { t, outlet, rooftop, t1, t9, table, outletField } = await outlets();
    const flow = await publish(t.api, 'Table order', {
      startFields: [outletField, table],
      steps: [task('serve', t.owner.id)],
    });
    const at = { owner: `flow:${flow}`, field: 'table' };
    const names = async (more: Record<string, string>) =>
      (await options(t.api, { ...at, ...more })).list.map((o) => o.value);
    expect(await names({ parent: 'Rooftop' })).toEqual(['T1', 'T2']);
    expect(await names({ parent: 'Lobby' })).toEqual(['T9']);
    expect(await names({ parent: 'Rooftop', q: 't2' })).toEqual(['T2']);
    // Nothing until the outlet is chosen; the field never lists every table.
    expect(await names({})).toEqual([]);
    expect(await names({ source: table.master })).toEqual([]);

    const order = (tableName: string, ref: string | null, outletName = 'Rooftop') =>
      start(t.api, flow, {
        outlet: outletName,
        table: tableName,
        _refs: { outlet: `row:${rooftop.id}`, ...(ref ? { table: ref } : {}) },
      });
    expect((await order('T1', `row:${t1.id}`)).status).toBe(200);
    // A table of another outlet: refused whether its link is sent or only its name.
    const wrong = await order('T9', `row:${t9.id}`);
    expect(wrong.status).toBe(400);
    expect(fieldError(wrong, 'table')).toBe('Table: "T9" does not belong to Rooftop');
    expect((await order('T9', null)).status).toBe(400);
    // A name sent without its link is matched to the right row; a table that is in no list may still be typed.
    expect((await order('t2', null)).body.data.table).toBe('T2');
    expect((await order('Terrace sofa', null)).status).toBe(200);
    // No outlet: a table cannot be chosen.
    const none = await start(t.api, flow, { table: 'T1', _refs: { table: `row:${t1.id}` } });
    expect(fieldError(none, 'table')).toBe('Table: choose Outlet first');

    // The outlet is renamed: its tables are still found through the link.
    await t.api.put(`/api/masters/${outlet}/rows/${rooftop.id}`, { name: 'Sky Bar' });
    expect(await names({ parent: 'Sky Bar', parentRef: `row:${rooftop.id}` })).toEqual(['T1']);
    expect(
      (
        await start(t.api, flow, {
          outlet: 'Sky Bar',
          table: 'T1',
          _refs: { outlet: `row:${rooftop.id}`, table: `row:${t1.id}` },
        })
      ).status,
    ).toBe(200);
  });

  it('L12: the other field may be on an earlier form of the record', async () => {
    const { t, rooftop, t1, t9, table, outletField } = await outlets();
    const flow = await publish(t.api, 'Reservation', {
      startFields: [outletField],
      steps: [task('seat', t.owner.id, [table])],
    });
    const rec = (await start(t.api, flow, { outlet: 'Rooftop', _refs: { outlet: `row:${rooftop.id}` } }))
      .body;
    const at = { owner: `flow:${flow}`, field: 'table', step: 'seat', record: rec.id, parent: 'Rooftop' };
    expect((await options(t.api, at)).list.map((o) => o.value)).toEqual(['T1', 'T2']);
    const wrong = await doStep(t.api, rec.id, { table: 'T9', _refs: { table: `row:${t9.id}` } });
    expect(fieldError(wrong, 'table')).toContain('does not belong to Rooftop');
    expect((await doStep(t.api, rec.id, { table: 'T1', _refs: { table: `row:${t1.id}` } })).status).toBe(200);
    const detail = (await t.api.get(`/api/fms/records/${rec.id}`)).body;
    expect(detail.steps[0].data).toEqual({ table: 'T1', _refs: { table: `row:${t1.id}` } });
  });
});
