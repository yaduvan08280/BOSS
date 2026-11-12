import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { itemsField, plant as plantIn, task, type Api } from './step-stock.fixture';

/** Phase 11, package D — stock on steps: not enough stock (L16), reversal (L17), company scoping. */
let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());
const plant = () => plantIn(ctx);

describe('L16 — not enough stock', () => {
  const short = (p: Awaited<ReturnType<typeof plant>>, mode: 'block' | 'flag') =>
    p.flow(`Issue (${mode})`, {
      startFields: [itemsField({ freeItems: false })],
      steps: [task('issue', p.doer.id, { stock: { action: 'ISSUE', short: mode } }), task('pack', p.doer.id)],
    });
  const lines = (p: Awaited<ReturnType<typeof plant>>) => ({
    lines: [
      { item: 'Polyester resin', qty: 50, itemId: p.resin.id },
      { item: 'Bearing 6205', qty: 20, itemId: p.bearing.id },
      { item: 'Bearing 6205', qty: 10, itemId: p.bearing.id },
    ],
  });

  it('L16: block refuses the step, naming the item and the shortfall, and nothing moves', async () => {
    const p = await plant();
    const rec = (await p.start(await short(p, 'block'), lines(p))).body;
    const step = await p.open(rec.id);
    const plan = (await p.doer.api.post(`/api/fms/steps/${step.id}/stock-preview`, {})).body.stock;
    expect(plan).toMatchObject({ short: 'block', blocked: true });
    // Two lines of the same item are counted together: 20 pass, the next 10 are short by 6.
    expect(plan.lines).toMatchObject([
      { short: false, after: 350 },
      { short: false, stock: 24, after: 4 },
      { short: true, stock: 4, shortBy: 6, after: 4 },
    ]);
    const r = await p.done(p.doer.api, step);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe(
      'Not enough stock: Bearing 6205 is short by 6 pcs (10 needed, 4 in stock)',
    );
    expect((await p.open(rec.id)).id).toBe(step.id);
    expect([await p.stock(p.resin.id), await p.stock(p.bearing.id)]).toEqual([400, 24]);
    expect(await p.moves(rec.id)).toHaveLength(0);
  });

  it('L16: flag lets the step pass and leaves a pending line that only an approver can approve or reject', async () => {
    const p = await plant();
    const flowId = await short(p, 'flag');
    const rec = (await p.start(flowId, lines(p))).body;
    const step = await p.open(rec.id);
    expect((await p.done(p.doer.api, step)).status).toBe(200);
    expect((await p.open(rec.id)).stepKey).toBe('pack');
    // What could go went; the short line moved nothing and waits.
    expect([await p.stock(p.resin.id), await p.stock(p.bearing.id)]).toEqual([350, 4]);
    const waiting = (await p.moves(rec.id)).filter((m) => m.status === 'PENDING');
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ type: 'OUT', itemId: p.bearing.id, stepId: step.id, balance: null });
    expect([Number(waiting[0]!.qty), Number(waiting[0]!.lineQty)]).toEqual([-10, 10]);
    expect((await p.record(rec.id)).events.map((e: { note: string | null }) => e.note)).toContain(
      'Stock out: 2 line(s) · 1 waiting for approval (Bearing 6205)',
    );
    // The approvers and the store keeper are told, the way adjustments are.
    const told = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { companyId: p.companyId, name: 'ims.adjustment_approval', entityId: waiting[0]!.id },
    });
    expect(told.payload).toMatchObject({ approverIds: [p.keeper.id], item: 'Bearing 6205', qty: '-10 pcs' });

    const decide = (who: Api, id: string, approve: boolean, note?: string) =>
      who.post(`/api/ims/moves/${id}/decide`, { approve, note });
    // Not an approver (the doer, the manager): no.
    expect((await decide(p.doer.api, waiting[0]!.id, true)).status).toBe(403);
    expect((await decide(p.boss.api, waiting[0]!.id, false)).status).toBe(403);
    // The approver sees it in the approvals list. Approving while stock is still short is refused: never below zero.
    const list = (await p.keeper.api.get('/api/ims/moves?status=PENDING')).body;
    expect(list.find((m: { id: string }) => m.id === waiting[0]!.id)).toMatchObject({ canDecide: true });
    const early = await decide(p.keeper.api, waiting[0]!.id, true);
    expect(early.status).toBe(409);
    expect(early.body.error.message).toBe('Only 4 pcs of Bearing 6205 in stock');
    expect(await p.stock(p.bearing.id)).toBe(4);
    // Stock comes in; approving now issues the line.
    await p.api.post('/api/ims/moves', { itemId: p.bearing.id, type: 'IN', qty: 20 });
    expect((await decide(p.keeper.api, waiting[0]!.id, true)).body).toEqual({ status: 'APPLIED' });
    expect(await p.stock(p.bearing.id)).toBe(14);
    expect((await decide(p.keeper.api, waiting[0]!.id, false)).status).toBe(409);

    // Rejecting: the line is not issued, stock stays, and the record's history says so.
    const two = (await p.start(flowId, { lines: [{ item: 'Bearing 6205', qty: 99, itemId: p.bearing.id }] }))
      .body;
    await p.done(p.doer.api, await p.open(two.id));
    const held = (await p.moves(two.id))[0]!;
    expect(held.status).toBe('PENDING');
    expect((await decide(p.keeper.api, held.id, false, 'Buy first')).body).toEqual({ status: 'REJECTED' });
    expect(await p.stock(p.bearing.id)).toBe(14);
    expect((await p.record(two.id)).events.map((e: { note: string | null }) => e.note)).toContain(
      'Stock not issued — the approver said no: Bearing 6205 99 pcs: Buy first',
    );
  });
});

describe('L17 — reversal', () => {
  it('L17: a rejection that sends the record back reverses the stock; redoing moves it again; cancel reverses everything once', async () => {
    const p = await plant();
    const f = await p.flow('Issue, check, pack', {
      startFields: [itemsField({ freeItems: false })],
      steps: [
        task('note', p.doer.id),
        task('issue', p.doer.id, { stock: { action: 'ISSUE', short: 'flag' } }),
        { ...task('ok', p.boss.id), type: 'APPROVAL', rejectTo: 'issue' },
        { key: 'post', name: 'Post', type: 'AUTO', auto: { action: 'stock', direction: 'IN' } },
        task('pack', p.doer.id),
      ],
    });
    const rec = (
      await p.start(f, {
        lines: [
          { item: 'Polyester resin', qty: 50, itemId: p.resin.id },
          { item: 'Bearing 6205', qty: 30, itemId: p.bearing.id },
        ],
      })
    ).body;
    const both = async () => [await p.stock(p.resin.id), await p.stock(p.bearing.id)];
    await p.done(p.doer.api, await p.open(rec.id));
    const first = await p.open(rec.id);
    await p.done(p.doer.api, first);
    expect(await both()).toEqual([350, 24]); // resin went; the bearings wait for an approver

    // Rejected → back to "issue": the issue is undone by a new move, the waiting line is withdrawn.
    await p.done(p.boss.api, await p.open(rec.id), { decision: 'rejected', note: 'Wrong grade' });
    expect(await both()).toEqual([400, 24]);
    let all = await p.moves(rec.id);
    expect(all).toHaveLength(3);
    const issued = all.find((m) => m.type === 'OUT' && m.status === 'APPLIED')!;
    const withdrawn = all.find((m) => m.status === 'REJECTED')!;
    const back = all.find((m) => m.type === 'IN')!;
    expect([Number(issued.qty), Number(withdrawn.qty), Number(back.qty)]).toEqual([-50, -30, 50]);
    expect(back).toMatchObject({ status: 'APPLIED', reversesId: issued.id, stepId: first.id });
    expect(withdrawn.decisionNote).toBe('Withdrawn — ok: rejected');
    // Nothing was edited: the first move still reads as it did.
    expect(issued).toMatchObject({ reversesId: null, stepId: first.id });
    expect(Number(issued.balance)).toBe(350);
    expect((await p.record(rec.id)).events.map((e: { note: string | null }) => e.note)).toContain(
      'Stock reversed (ok: rejected): 1 move(s) · 1 waiting line(s) withdrawn',
    );

    // Redo the step: it moves again (a new step row, new moves); approve; the AUTO step receives.
    const second = await p.open(rec.id);
    expect(second).toMatchObject({ stepKey: 'issue' });
    expect(second.id).not.toBe(first.id);
    await p.done(p.doer.api, second);
    expect(await both()).toEqual([350, 24]);
    await p.done(p.boss.api, await p.open(rec.id), { decision: 'approved' });
    expect(await both()).toEqual([400, 54]); // AUTO "stock in" for both lines
    expect((await p.open(rec.id)).stepKey).toBe('pack');

    // Cancel: every move still standing is undone, once; the line that waits is withdrawn.
    const cancel = () =>
      p.boss.api.post(`/api/fms/records/${rec.id}/actions`, { action: 'cancel', reason: 'Order dropped' });
    expect((await cancel()).status).toBe(200);
    expect(await both()).toEqual([400, 24]);
    expect((await cancel()).status).toBe(409);
    expect(await both()).toEqual([400, 24]);
    all = await p.moves(rec.id);
    const undone = all.filter((m) => m.reversesId);
    expect(new Set(undone.map((m) => m.reversesId)).size).toBe(undone.length);
    // Every applied move that is not itself a reversal has exactly one reversal; nothing waits any more.
    const originals = all.filter((m) => !m.reversesId && m.status === 'APPLIED');
    expect(originals.map((m) => undone.filter((u) => u.reversesId === m.id).length)).toEqual(
      originals.map(() => 1),
    );
    expect(all.filter((m) => m.status === 'PENDING')).toHaveLength(0);
    const listed = (await p.boss.api.get(`/api/fms/records/${rec.id}/stock`)).body;
    expect(listed.filter((m: { reversed: string | null }) => m.reversed === 'APPLIED')).toHaveLength(
      originals.length,
    );
  });

  it('L17: a reversal that cannot be applied does not stop the cancel — it waits for an approver and is noted', async () => {
    const p = await plant();
    const f = await p.flow('Goods in', {
      startFields: [itemsField({ freeItems: false })],
      steps: [task('receive', p.doer.id, { stock: { action: 'RECEIVE' } }), task('check', p.doer.id)],
    });
    const rec = (await p.start(f, { lines: [{ item: 'Bearing 6205', qty: 10, itemId: p.bearing.id }] })).body;
    await p.done(p.doer.api, await p.open(rec.id));
    expect(await p.stock(p.bearing.id)).toBe(34);
    // Most of it is used before the record is cancelled.
    await p.api.post('/api/ims/moves', { itemId: p.bearing.id, type: 'OUT', qty: 30 });
    const r = await p.boss.api.post(`/api/fms/records/${rec.id}/actions`, {
      action: 'cancel',
      reason: 'Wrong PO',
    });
    expect(r.status).toBe(200);
    expect((await p.record(rec.id)).status).toBe('CANCELLED');
    expect(await p.stock(p.bearing.id)).toBe(4);
    const [receipt, held] = await p.moves(rec.id);
    expect(held).toMatchObject({ status: 'PENDING', type: 'OUT', reversesId: receipt!.id });
    expect((await p.record(rec.id)).events.map((e: { note: string | null }) => e.note)).toContain(
      'Stock reversed (record cancelled): 0 move(s) · Bearing 6205: 10 pcs could not be taken back ' +
        '(Only 4 pcs of Bearing 6205 in stock) · the store keeper has been told',
    );
    expect(
      await ctx.prisma.domainEvent.count({
        where: { companyId: p.companyId, name: 'ims.adjustment_approval', entityId: held!.id },
      }),
    ).toBe(1);
    // Stock comes back; the approver applies the reversal. It can never be made twice.
    await p.api.post('/api/ims/moves', { itemId: p.bearing.id, type: 'IN', qty: 20 });
    expect((await p.keeper.api.post(`/api/ims/moves/${held!.id}/decide`, { approve: true })).body).toEqual({
      status: 'APPLIED',
    });
    expect(await p.stock(p.bearing.id)).toBe(14);
    await expect(
      ctx.prisma.stockMove.create({
        data: {
          companyId: p.companyId,
          itemId: p.bearing.id,
          type: 'OUT',
          qty: -10,
          reversesId: receipt!.id,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('company scoping', () => {
  it('L15/L16: another company cannot preview a step, read a record’s stock or decide its waiting line', async () => {
    const p = await plant();
    const other = await plant();
    const f = await p.flow('Issue', {
      startFields: [itemsField({ freeItems: false })],
      steps: [
        task('issue', p.doer.id, { stock: { action: 'ISSUE', short: 'flag' } }),
        task('pack', p.doer.id),
      ],
    });
    const rec = (await p.start(f, { lines: [{ item: 'Bearing 6205', qty: 99, itemId: p.bearing.id }] })).body;
    const step = await p.open(rec.id);
    expect((await other.api.post(`/api/fms/steps/${step.id}/stock-preview`, {})).status).toBe(404);
    await p.done(p.doer.api, step);
    const held = (await p.moves(rec.id))[0]!;
    expect((await other.api.get(`/api/fms/records/${rec.id}/stock`)).status).toBe(404);
    expect((await other.keeper.api.post(`/api/ims/moves/${held.id}/decide`, { approve: false })).status).toBe(
      404,
    );
    expect((await other.api.post(`/api/ims/moves/${held.id}/decide`, { approve: false })).status).toBe(404);
    // The other company's stock of its own "Bearing 6205" never moved.
    expect(await other.stock(other.bearing.id)).toBe(24);
    expect((await ctx.prisma.stockMove.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('PENDING');
  });
});
