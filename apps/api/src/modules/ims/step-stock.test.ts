import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { startRecord } from '../fms/engine';
import { itemsField, plant as plantIn, task, type Step } from './step-stock.fixture';

/** Phase 11, package D — stock on steps: item lines (L14) and stock moved by any step (L15). */
let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());
const plant = () => plantIn(ctx);

describe('L14 — item lines pick from the item master', () => {
  it('L14: a picked line keeps itemId and unit; typed lines are refused unless the field allows them', async () => {
    const p = await plant();
    const strict = await p.flow('Picked only', {
      startFields: [itemsField({ freeItems: false })],
      steps: [task('do', p.doer.id)],
    });
    // Picked: the line reads as the master does and keeps its link and unit; the rate stays what was typed.
    const picked = await p.start(strict, {
      lines: [{ item: 'bearing', qty: '2', rate: '310', itemId: p.bearing.id }],
    });
    expect(picked.status).toBe(200);
    expect((await p.record(picked.body.id)).data.lines).toEqual([
      { item: 'Bearing 6205', qty: 2, rate: 310, amount: 620, itemId: p.bearing.id, unit: 'pcs' },
    ]);
    // Typed, not in the master: refused, on the field.
    const typed = await p.start(strict, { lines: [{ item: 'Glue', qty: 1, rate: 10 }] });
    expect(typed.status).toBe(400);
    expect(typed.body.error.details.fields.lines).toBe(
      'Items: "Glue" is not in the item master — pick an item from the list',
    );
    // Typed, but it is an item's code: linked (the API and imports send codes).
    const byCode = await p.start(strict, { lines: [{ item: 'rm-002', qty: 5, rate: 180 }] });
    expect((await p.record(byCode.body.id)).data.lines[0]).toMatchObject({
      item: 'Polyester resin',
      itemId: p.resin.id,
      unit: 'kg',
    });
    // An item switched off can't be picked any more.
    await ctx.prisma.item.update({ where: { id: p.resin.id }, data: { active: false } });
    const off = await p.start(strict, { lines: [{ item: 'Polyester resin', qty: 1, itemId: p.resin.id }] });
    expect(off.status).toBe(400);
    await ctx.prisma.item.update({ where: { id: p.resin.id }, data: { active: true } });

    // "Typed items allowed": both kinds pass; a typed line stays as typed, and is linked when it names an item.
    const free = await p.flow('Typed too', {
      startFields: [itemsField({ freeItems: true })],
      steps: [task('do', p.doer.id)],
    });
    const both = await p.start(free, {
      lines: [
        { item: 'Glue', qty: 1, rate: 10 },
        { item: 'sp-6205', qty: 1, rate: 250 },
      ],
    });
    expect((await p.record(both.body.id)).data.lines).toEqual([
      { item: 'Glue', qty: 1, rate: 10, amount: 10 },
      { item: 'sp-6205', qty: 1, rate: 250, amount: 250, itemId: p.bearing.id, unit: 'pcs' },
    ]);
  });

  it("L14: another company's item is refused, even on a field that allows typed items", async () => {
    const p = await plant();
    const other = await plant();
    for (const freeItems of [false, true]) {
      const f = await p.flow(`Scoped ${freeItems}`, {
        startFields: [itemsField({ freeItems })],
        steps: [task('do', p.doer.id)],
      });
      const r = await p.start(f, { lines: [{ item: 'Bearing 6205', qty: 1, itemId: other.bearing.id }] });
      expect(r.status).toBe(400);
      expect(r.body.error.details.fields.lines).toContain('pick it again');
    }
  });

  it('L14: a flow from before phase 11 (no freeItems) and the public form still accept typed lines', async () => {
    const p = await plant();
    const old = await p.flow('Old flow', { startFields: [itemsField()], steps: [task('do', p.doer.id)] });
    const version = await ctx.prisma.flowVersion.findFirstOrThrow({ where: { flowId: old } });
    // The published definition holds no setting the old one did not have.
    expect((version.definition as { startFields: object[] }).startFields[0]).not.toHaveProperty('freeItems');
    const r = await p.start(old, { lines: [{ item: 'Carrara 20mm', qty: 10, rate: 4500 }] });
    expect(r.status).toBe(200);
    expect((await p.record(r.body.id)).data.lines).toEqual([
      { item: 'Carrara 20mm', qty: 10, rate: 4500, amount: 45000 },
    ]);
    // The public form has no item list to pick from: typed lines pass even where the field takes only items.
    const strict = await p.flow('Public', {
      startFields: [itemsField({ freeItems: false })],
      steps: [task('do', p.doer.id)],
    });
    const pub = await startRecord(ctx.prisma, {
      ...{ companyId: p.companyId, flowId: strict, startedById: null, source: 'public' },
      data: { lines: [{ item: 'Something else', qty: 1 }] },
    });
    expect((pub.data as { lines: object[] }).lines).toEqual([
      { item: 'Something else', qty: 1, rate: 0, amount: 0 },
    ]);
  });
});

describe('L15 — any step moves stock', () => {
  it('L15: receive, issue and transfer on TASK steps, the place fixed or from a field; the preview matches what happens', async () => {
    const p = await plant();
    const f = await p.flow('Receive, issue, shift', {
      startFields: [itemsField({ freeItems: false }), { key: 'bay', label: 'Bay', type: 'text' }],
      steps: [
        task('receive', p.doer.id, { stock: { action: 'RECEIVE', to: { fixed: 'Main store' } } }),
        task('issue', p.doer.id, {
          stock: { action: 'ISSUE', from: { fixed: 'Main store' }, to: { field: 'bay' } },
        }),
        task('shift', p.doer.id, {
          fields: [{ key: 'rack', label: 'Rack', type: 'text' }],
          stock: { action: 'TRANSFER', to: { field: 'rack' } },
        }),
        { key: 'post', name: 'Post', type: 'AUTO', auto: { action: 'stock', direction: 'OUT' } },
      ],
    });
    const rec = (
      await p.start(f, {
        bay: 'Press 2',
        lines: [
          { item: 'Bearing 6205', qty: 6, rate: 250, itemId: p.bearing.id },
          { item: 'Polyester resin', qty: 50, rate: 180, itemId: p.resin.id },
        ],
      })
    ).body;
    const preview = async (step: Step, data: object = {}) =>
      (await p.doer.api.post(`/api/fms/steps/${step.id}/stock-preview`, { data })).body.stock;
    const after = async () => [await p.stock(p.bearing.id), await p.stock(p.resin.id)];

    // Receive: + on both lines.
    let step = await p.open(rec.id);
    let plan = await preview(step);
    expect(plan).toMatchObject({ action: 'RECEIVE', blocked: false });
    expect(plan.lines).toMatchObject([
      { name: 'Bearing 6205', code: 'SP-6205', unit: 'pcs', qty: 6, stock: 24, after: 30, to: 'Main store' },
      { name: 'Polyester resin', qty: 50, stock: 400, after: 450, short: false },
    ]);
    expect((await p.done(p.doer.api, step)).status).toBe(200);
    expect(await after()).toEqual(plan.lines.map((l: { after: number }) => l.after));

    // Issue: from a fixed place to the bay typed on the start form.
    step = await p.open(rec.id);
    plan = await preview(step);
    expect(plan.lines).toMatchObject([
      { stock: 30, after: 24, from: 'Main store', to: 'Press 2' },
      { stock: 450, after: 400 },
    ]);
    await p.done(p.doer.api, step);
    expect(await after()).toEqual([24, 400]);

    // Transfer: nowhere to go yet → the preview says so and the step is refused; then to the rack typed on the step.
    step = await p.open(rec.id);
    expect(await preview(step)).toMatchObject({ blocked: true, problem: 'Say where the stock moves to' });
    expect((await p.done(p.doer.api, step)).body.error.message).toBe('Say where the stock moves to');
    plan = await preview(step, { rack: 'Rack B4' });
    expect(plan.lines).toMatchObject([
      { stock: 24, after: 24, to: 'Rack B4' },
      { stock: 400, after: 400, to: 'Rack B4' },
    ]);
    await p.done(p.doer.api, step, { data: { rack: 'Rack B4' } });
    expect((await ctx.prisma.item.findUniqueOrThrow({ where: { id: p.bearing.id } })).location).toBe(
      'Rack B4',
    );

    // The AUTO stock step ran through the same code: the record closed and every move carries its record and step.
    expect((await p.record(rec.id)).status).toBe('CLOSED');
    expect(await after()).toEqual([18, 350]);
    const all = await p.moves(rec.id);
    const steps = (await p.record(rec.id)).steps as Step[];
    const of = (key: string) => all.filter((m) => m.stepId === steps.find((s) => s.stepKey === key)!.id);
    expect(all).toHaveLength(8);
    expect(of('receive').map((m) => [m.type, Number(m.qty), m.toLocation])).toEqual([
      ['IN', 6, 'Main store'],
      ['IN', 50, 'Main store'],
    ]);
    expect(of('issue').map((m) => [m.type, Number(m.qty), m.fromLocation, m.toLocation])).toEqual([
      ['OUT', -6, 'Main store', 'Press 2'],
      ['OUT', -50, 'Main store', 'Press 2'],
    ]);
    expect(of('shift').map((m) => [m.type, Number(m.qty), Number(m.lineQty), m.toLocation])).toEqual([
      ['TRANSFER', 0, 6, 'Rack B4'],
      ['TRANSFER', 0, 50, 'Rack B4'],
    ]);
    expect(of('post').map((m) => [m.type, Number(m.qty)])).toEqual([
      ['OUT', -6],
      ['OUT', -50],
    ]);
    // The record's drawer lists them, and its history says what each step moved.
    const listed = (await p.doer.api.get(`/api/fms/records/${rec.id}/stock`)).body;
    expect(listed).toHaveLength(8);
    expect(listed.find((m: { item: { code: string } }) => m.item.code === 'RM-002')).toMatchObject({
      ...{ type: 'IN', qty: 50, status: 'APPLIED', reversal: false, reversed: null },
      item: { code: 'RM-002', name: 'Polyester resin', unit: 'kg' },
    });
    const notes = (await p.record(rec.id)).events.map((e: { note: string | null }) => e.note);
    expect(notes).toEqual(
      expect.arrayContaining([
        'Stock in: 2 line(s)',
        'Stock out: 2 line(s)',
        'Stock moved to Rack B4: 2 line(s)',
      ]),
    );
  });

  it('L15: an approval moves its stock only when approved; only the people of the step see its preview', async () => {
    const p = await plant();
    const f = await p.flow('Approve to issue', {
      startFields: [itemsField({ freeItems: false })],
      steps: [
        { ...task('ok', p.boss.id), type: 'APPROVAL', stock: { action: 'ISSUE' } },
        task('pack', p.doer.id),
      ],
    });
    const line = { lines: [{ item: 'Bearing 6205', qty: 4, itemId: p.bearing.id }] };
    const no = (await p.start(f, line)).body;
    let step = await p.open(no.id);
    // The doer of another step is not the approver: no preview for them.
    expect((await p.doer.api.post(`/api/fms/steps/${step.id}/stock-preview`, {})).status).toBe(403);
    expect(
      (await p.boss.api.post(`/api/fms/steps/${step.id}/stock-preview`, {})).body.stock.lines,
    ).toMatchObject([{ qty: 4, stock: 24, after: 20 }]);
    await p.done(p.boss.api, step, { decision: 'rejected', note: 'Not now' });
    expect(await p.stock(p.bearing.id)).toBe(24);
    const yes = (await p.start(f, line)).body;
    step = await p.open(yes.id);
    await p.done(p.boss.api, step, { decision: 'approved' });
    expect(await p.stock(p.bearing.id)).toBe(20);
    // A step without a stock setting has nothing to preview.
    step = await p.open(yes.id);
    expect((await p.doer.api.post(`/api/fms/steps/${step.id}/stock-preview`, {})).body).toEqual({
      stock: null,
    });
  });
});
