import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { cancel, doStep, publish, republish, start, task, team } from '../forms/test-kit';
import { makeRecord, makeType, siteVisit, world } from '../records/testkit';
import { runBackfills } from './backfill';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Copy = {
  field: string;
  text: string | null;
  norm: string | null;
  number: number | null;
  day: string | null;
  ref: string | null;
};
const copies = async (recordId: string): Promise<Copy[]> =>
  (await ctx.prisma.reportValue.findMany({ where: { recordId }, orderBy: { field: 'asc' } })).map((v) => ({
    field: v.field,
    text: v.text,
    norm: v.norm,
    number: v.number === null ? null : Number(v.number),
    day: v.day ? v.day.toISOString().slice(0, 10) : null,
    ref: v.ref,
  }));

describe('reportable fields keep a typed, indexed copy (plan §2.7)', () => {
  it('U9: saving a record writes text, number, date and link copies; a change updates them; cancelling removes them', async () => {
    const t = await team(ctx);
    const customer = (await t.api.post('/api/crm/customers', { name: 'Sharma Traders', city: 'Ajmer' })).body;
    const flowId = await publish(t.api, 'Orders', {
      startFields: [
        { key: 'customer', label: 'Customer', type: 'master', master: 'customers', reportable: true },
        { key: 'qty', label: 'Qty', type: 'number', reportable: true },
        { key: 'rate', label: 'Rate', type: 'amount', reportable: true },
        { key: 'value', label: 'Value', type: 'formula', formula: 'qty * rate', reportable: true },
        { key: 'due', label: 'Due', type: 'date', reportable: true },
        { key: 'urgent', label: 'Urgent', type: 'yesno', reportable: true },
        { key: 'remark', label: 'Remark', type: 'text' }, // not reportable: no copy
      ],
      steps: [
        task('pack', t.owner.id, [
          { key: 'packed_at', label: 'Packed at', type: 'datetime', reportable: true },
          { key: 'boxes', label: 'Boxes', type: 'number', reportable: true },
        ]),
        task('ship', t.owner.id),
      ],
    });
    const order = (
      await start(t.api, flowId, {
        customer: 'Sharma Traders',
        qty: 12,
        rate: 1500.5,
        due: '2026-12-14',
        urgent: true,
        remark: 'Handle with care',
        _refs: { customer: `customer:${customer.id}` },
      })
    ).body as { id: string };
    expect(await copies(order.id)).toEqual([
      {
        field: 'customer',
        text: 'Sharma Traders',
        norm: 'sharma traders',
        number: null,
        day: null,
        ref: `customer:${customer.id}`,
      },
      { field: 'due', text: '14/12/2026', norm: '14/12/2026', number: null, day: '2026-12-14', ref: null },
      { field: 'qty', text: '12', norm: '12', number: 12, day: null, ref: null },
      { field: 'rate', text: '₹1,500.5', norm: '₹1,500.5', number: 1500.5, day: null, ref: null },
      { field: 'urgent', text: 'Yes', norm: 'yes', number: null, day: null, ref: null },
      { field: 'value', text: '18,006', norm: '18,006', number: 18006, day: null, ref: null },
    ]);
    // A step adds its own values to the same record: a date-time is kept as its day in the company's time zone.
    await doStep(t.api, order.id, { packed_at: '2026-12-14T20:30:00.000Z', boxes: 3 });
    const after = await copies(order.id);
    expect(after.find((c) => c.field === 'packed_at')).toMatchObject({
      day: '2026-12-15',
      text: '15/12/2026 02:00',
    });
    expect(after.find((c) => c.field === 'boxes')).toMatchObject({ number: 3 });
    expect(after).toHaveLength(8);
    // The copies belong to this company and this process only.
    const rows = await ctx.prisma.reportValue.findMany({ where: { recordId: order.id } });
    expect(new Set(rows.map((r) => `${r.companyId}|${r.ownerKind}|${r.ownerId}`))).toEqual(
      new Set([`${t.company.id}|flow|${flowId}`]),
    );
    // A cancelled record is out of every report: its copies go.
    await cancel(t.api, order.id);
    expect(await copies(order.id)).toEqual([]);
  });

  it('U9: a record type — an emptied value loses its copy, a deleted record loses all', async () => {
    const w = await world(ctx.app);
    const base = siteVisit();
    const typeId = await makeType(w.api, {
      ...base,
      definition: {
        ...base.definition,
        fields: base.definition.fields.map((f) =>
          ['site', 'cost', 'visit_on'].includes(f.key) ? { ...f, reportable: true } : f,
        ),
      },
    });
    const visit = await makeRecord(w.api, typeId, {
      site: 'Tonk  Mine',
      cost: 2500,
      visit_on: '2026-11-20',
      kind: 'Survey',
    });
    expect(await copies(visit.id)).toEqual([
      { field: 'cost', text: '₹2,500', norm: '₹2,500', number: 2500, day: null, ref: null },
      { field: 'site', text: 'Tonk  Mine', norm: 'tonk mine', number: null, day: null, ref: null },
      {
        field: 'visit_on',
        text: '20/11/2026',
        norm: '20/11/2026',
        number: null,
        day: '2026-11-20',
        ref: null,
      },
    ]);
    await w.api.patch(`/api/records/entries/${visit.id}`, { data: { site: 'Niwai factory', cost: 3000 } });
    expect(await copies(visit.id)).toEqual([
      { field: 'cost', text: '₹3,000', norm: '₹3,000', number: 3000, day: null, ref: null },
      { field: 'site', text: 'Niwai factory', norm: 'niwai factory', number: null, day: null, ref: null },
    ]);
    await w.api.del(`/api/records/entries/${visit.id}`);
    expect(await copies(visit.id)).toEqual([]);
  });

  it('U9: a field marked reportable later is back-filled by the worker in batches, safely more than once; unmarking removes the copies', async () => {
    const w = await world(ctx.app);
    const typeId = await makeType(w.api);
    const made = [];
    for (let i = 1; i <= 7; i++)
      made.push(await makeRecord(w.api, typeId, { site: `Site ${i}`, cost: i * 100 }));
    const gone = made[6]!;
    await w.api.del(`/api/records/entries/${gone.id}`);
    const where = { ownerKind: 'recordType', ownerId: typeId };
    expect(await ctx.prisma.reportValue.count({ where })).toBe(0);

    // The admin marks "Cost" and "Kind" reportable: six live records are waiting to be copied.
    const def = siteVisit().definition;
    const mark = (keys: string[]) =>
      w.api.patch(`/api/records/types/${typeId}`, {
        definition: {
          ...def,
          fields: def.fields.map((f) => (keys.includes(f.key) ? { ...f, reportable: true } : f)),
        },
      });
    expect((await mark(['cost', 'kind'])).status).toBe(200);
    const state = async () =>
      (await w.api.get(`/api/reports/backfills?owner=recordType:${typeId}`)).body as {
        field: string;
        status: string;
        copied: number;
        total: number;
      }[];
    expect(await state()).toEqual([
      { field: 'cost', status: 'PENDING', copied: 0, total: 6 },
      { field: 'kind', status: 'PENDING', copied: 0, total: 6 },
    ]);
    // A record saved while the copy is still waiting gets its copy at once, from the form itself.
    const fresh = await makeRecord(w.api, typeId, { site: 'Site 8', cost: 800 });
    expect((await copies(fresh.id)).map((c) => [c.field, c.number])).toEqual([['cost', 800]]);

    // The worker: two records a batch, one batch a run → it stops part-way and goes on next time.
    await runBackfills(ctx.prisma, { batch: 2, batches: 1 });
    expect((await state())[0]).toMatchObject({ field: 'cost', status: 'PENDING', copied: 2 });
    await runBackfills(ctx.prisma, { batch: 2, batches: 50 });
    expect(await state()).toEqual([
      { field: 'cost', status: 'DONE', copied: 7, total: 7 },
      { field: 'kind', status: 'DONE', copied: 7, total: 7 },
    ]);
    const costs = await ctx.prisma.reportValue.findMany({ where: { ...where, field: 'cost' } });
    expect(costs.map((c) => Number(c.number)).sort((a, b) => a - b)).toEqual([
      100, 200, 300, 400, 500, 600, 800,
    ]);
    // Nobody typed a kind: nothing to copy for it; the deleted record has no copy either.
    expect(await ctx.prisma.reportValue.count({ where: { ...where, field: 'kind' } })).toBe(0);
    expect(await copies(gone.id)).toEqual([]);
    // Running again changes nothing.
    await runBackfills(ctx.prisma, { batch: 2, batches: 50 });
    expect(await ctx.prisma.reportValue.count({ where })).toBe(7);

    // Unmarking a field removes its copies and its place in the list; another company sees nothing of it.
    await mark(['kind']);
    expect(await ctx.prisma.reportValue.count({ where })).toBe(0);
    expect(await state()).toEqual([{ field: 'kind', status: 'DONE', copied: 7, total: 7 }]);
    const other = await world(ctx.app);
    expect((await other.api.get(`/api/reports/backfills?owner=recordType:${typeId}`)).body).toEqual([]);
  });

  it('U9: a process — values of records started before the field was reportable are copied after the next publish', async () => {
    const t = await team(ctx);
    const startFields = [
      { key: 'party', label: 'Party', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'amount' },
    ];
    const steps = [
      task('check', t.owner.id, [{ key: 'grade', label: 'Grade', type: 'dropdown', options: ['A', 'B'] }]),
    ];
    const flowId = await publish(t.api, 'Purchases', { startFields, steps });
    const one = (await start(t.api, flowId, { party: 'Jaipur Granite House', amount: 45000 })).body as {
      id: string;
    };
    const two = (await start(t.api, flowId, { party: 'Mehta Interiors', amount: 12000 })).body as {
      id: string;
    };
    await doStep(t.api, one.id, { grade: 'A' });
    await cancel(t.api, two.id);
    await republish(t.api, flowId, {
      startFields: startFields.map((f) => ({ ...f, reportable: true })),
      steps: [
        task('check', t.owner.id, [
          { key: 'grade', label: 'Grade', type: 'dropdown', options: ['A', 'B'], reportable: true },
        ]),
      ],
    });
    await runBackfills(ctx.prisma);
    expect((await copies(one.id)).map((c) => [c.field, c.text])).toEqual([
      ['amount', '₹45,000'],
      ['grade', 'A'],
      ['party', 'Jaipur Granite House'],
    ]);
    expect(await copies(two.id)).toEqual([]); // cancelled: not in reports
  });
});
