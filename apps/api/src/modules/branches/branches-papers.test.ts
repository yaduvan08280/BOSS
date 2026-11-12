import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { publish, start, task } from '../forms/test-kit';
import { world } from '../records/testkit';
import { letterheadOf } from './letterhead';
import { ok, twoOutlets, type World } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/** The hotel group plus a second company of the group in Ajmer, each with what it prints on papers. */
async function twoEntities(w: World) {
  const o = await twoOutlets(ctx.prisma, w);
  await ok(
    w.api.patch(`/api/branches/entities/${o.g.entity.id}`, {
      name: 'GGM Hotels Rajasthan',
      taxId: '08AAAAA0000A1Z5',
      details: {
        legalName: 'GGM Hotels Rajasthan Private Limited',
        address: '12 MI Road, Jaipur 302001',
        seriesCode: 'RJ',
        letterheadFooter: 'Subject to Jaipur jurisdiction',
        licences: [{ name: 'Trade', number: 'TR-55', validTill: '2031-03-31' }],
      },
    }),
  );
  const ajmer = await ok<{ id: string }>(
    w.api.post('/api/branches/entities', {
      name: 'Ajmer Foods LLP',
      taxId: '08BBBBB1111B1Z2',
      details: { address: 'Lake Road, Ajmer', seriesCode: 'AJ' },
    }),
  );
  await ok(
    w.api.patch(`/api/org/branches/${o.g.b.lake.id}`, {
      name: 'Lake View Ajmer',
      entityId: ajmer.id,
      details: {
        address: 'Ana Sagar, Ajmer',
        seriesCode: 'LAKE',
        licences: [{ name: 'FSSAI', number: '1220-LAKE' }],
      },
    }),
  );
  await ok(
    w.api.patch(`/api/org/branches/${o.g.b.rooftop.id}`, {
      name: 'Rooftop Jaipur',
      details: { licences: [{ name: 'FSSAI', number: '1220-ROOF' }] },
    }),
  );
  return { ...o, ajmer };
}

describe('entities, number series and papers (phase 12, stage B)', () => {
  it('G22: an entity carries its address, letterhead and licences; a branch its own; codes must be clean', async () => {
    const w = await world(ctx.app);
    const { g } = await twoEntities(w);
    const head = await letterheadOf(ctx.prisma, w.companyId, g.b.rooftop.id);
    expect(head).toMatchObject({
      name: 'GGM Hotels Rajasthan Private Limited',
      address: '12 MI Road, Jaipur 302001',
      tax: 'GSTIN 08AAAAA0000A1Z5',
      branch: 'Rooftop Jaipur',
      entityCode: 'RJ',
      footer: 'Subject to Jaipur jurisdiction',
    });
    // The outlet's own licence first, then the company's.
    expect(head.licences.map((l) => `${l.name} ${l.number}`)).toEqual(['FSSAI 1220-ROOF', 'Trade TR-55']);
    // A branch of another entity prints that entity; work with no branch prints the company, as before.
    expect(await letterheadOf(ctx.prisma, w.companyId, g.b.lake.id)).toMatchObject({
      name: 'Ajmer Foods LLP',
      tax: 'GSTIN 08BBBBB1111B1Z2',
      branchAddress: 'Ana Sagar, Ajmer',
      branchCode: 'LAKE',
    });
    const none = await letterheadOf(ctx.prisma, w.companyId, null);
    expect(none).toMatchObject({ entityId: null, entityCode: null, licences: [] });
    // A series code is short capitals; a licence needs its number.
    const bad = (details: object) =>
      w.api.patch(`/api/branches/entities/${g.entity.id}`, { name: 'GGM Hotels Rajasthan', details });
    expect((await bad({ seriesCode: 'raj-1' })).status).toBe(400);
    expect((await bad({ licences: [{ name: 'FSSAI', number: '' }] })).status).toBe(400);
    // What was saved comes back for the set-up screen.
    const s = await ok<{ entities: { name: string; details: { seriesCode?: string } }[] }>(
      w.api.get('/api/branches/structure'),
    );
    expect(s.entities.find((e) => e.name === 'GGM Hotels Rajasthan')!.details.seriesCode).toBe('RJ');
  });

  it('G23, G24: a series per entity or branch; the paper prints the right entity, branch and licences', async () => {
    const w = await world(ctx.app);
    const { rooftop, lake } = await twoEntities(w);
    const type = (code: string, series?: string) =>
      ok(
        w.api.put('/api/document-types', {
          code,
          name: `${code} paper`,
          prefix: code,
          header: 'From {{entity}}, {{address}} — GSTIN {{gstin}} — {{branch}} — FSSAI {{licence.FSSAI}}',
          ...(series ? { series } : {}),
        }),
      );
    await type('INV', 'entity');
    await type('KOT', 'branch');
    await type('GRN');
    const flowId = await publish(w.api, 'Billing', {
      startFields: [{ key: 'guest', label: 'Guest', type: 'text', required: true }],
      steps: [{ ...task('bill', w.owner.id), documents: ['INV', 'KOT', 'GRN'] }],
    });
    const papers = async (api: World['api'], guest: string) => {
      const rec = (await start(api, flowId, { guest })).body as { id: string };
      const step = await ctx.prisma.fmsRecordStep.findFirstOrThrow({
        where: { recordId: rec.id, status: 'OPEN' },
      });
      await ok(w.api.post(`/api/fms/steps/${step.id}/complete`, { data: {} }));
      const docs = await ctx.prisma.document.findMany({
        where: { recordId: rec.id },
        orderBy: { number: 'asc' },
      });
      return docs.map((d) => d.number).map((n) => n.replace(/\/\d\d-\d\d\//, '/FY/'));
    };
    // Each GSTIN has its own invoice numbers; each outlet its own KOT numbers; GRN stays one company series.
    expect(await papers(rooftop.api, 'Rooftop 1')).toEqual([
      'GRN/FY/0001',
      'INV/RJ/FY/0001',
      expect.stringMatching(/^KOT\/[A-Z0-9]{4}\/FY\/0001$/),
    ]);
    expect(await papers(lake.api, 'Lake 1')).toEqual(['GRN/FY/0002', 'INV/AJ/FY/0001', 'KOT/LAKE/FY/0001']);
    expect(await papers(rooftop.api, 'Rooftop 2')).toEqual([
      'GRN/FY/0003',
      'INV/RJ/FY/0002',
      expect.stringMatching(/^KOT\/[A-Z0-9]{4}\/FY\/0002$/),
    ]);
    // A record with no branch (the owner's own) keeps the company's plain series even for a per-entity type.
    expect(await papers(w.api, 'Head office')).toEqual(['GRN/FY/0004', 'INV/FY/0001', 'KOT/FY/0001']);

    // The paper itself: the lake's invoice is from Ajmer Foods at the lake, with the lake's FSSAI number.
    const inv = await ctx.prisma.document.findFirstOrThrow({
      where: { companyId: w.companyId, number: { startsWith: 'INV/AJ/' } },
    });
    const list = await ok<{ documents: { id: string; number: string }[] } | { id: string; number: string }[]>(
      lake.api.get('/api/documents'),
    );
    expect(JSON.stringify(list)).toContain(inv.number);
    const { documentPdf, paperTexts } = await import('../fms/documents');
    expect((await documentPdf(ctx.prisma, w.companyId, inv.id)).pdf.subarray(0, 4).toString()).toBe('%PDF');
    const company = await ctx.prisma.company.findUniqueOrThrow({ where: { id: w.companyId } });
    const full = await ctx.prisma.document.findUniqueOrThrow({
      where: { id: inv.id },
      include: { type: true },
    });
    const texts = await paperTexts(
      ctx.prisma,
      full,
      company,
      new Map(),
      await letterheadOf(ctx.prisma, w.companyId, full.branchId),
    );
    expect(texts.header).toBe(
      'From Ajmer Foods LLP, Lake Road, Ajmer — GSTIN 08BBBBB1111B1Z2 — Lake View Ajmer — FSSAI 1220-LAKE',
    );
  });
  it("G35: an entity's tax profile, filled by the accountant, names its tax number and prints its legal lines", async () => {
    const w = await world(ctx.app);
    const { g, rooftop } = await twoOutlets(ctx.prisma, w);
    const dubai = await ok<{ id: string }>(
      w.api.post('/api/branches/entities', {
        name: 'GGM Gulf LLC',
        country: 'AE',
        currency: 'AED',
        taxId: '100234567800003',
        details: {
          seriesCode: 'DXB',
          tax: {
            regime: 'VAT',
            idLabel: 'TRN',
            invoiceTitle: 'Tax Invoice',
            rates: [{ name: 'VAT 5%', percent: 5 }],
            note: 'Prices include 5% VAT',
          },
        },
      }),
    );
    const marina = await ok<{ id: string }>(
      w.api.post('/api/org/branches', { name: 'Marina Dubai', type: 'OUTLET', entityId: dubai.id }),
    );
    // The profile is data: a regime outside the list, or a rate over 100%, is refused.
    const bad = (tax: object) =>
      w.api.patch(`/api/branches/entities/${dubai.id}`, { name: 'GGM Gulf LLC', details: { tax } });
    expect((await bad({ regime: 'MAGIC' })).status).toBe(400);
    expect((await bad({ regime: 'VAT', rates: [{ name: 'VAT', percent: 500 }] })).status).toBe(400);
    const gulf = await letterheadOf(ctx.prisma, w.companyId, marina.id);
    expect(gulf).toMatchObject({
      tax: 'TRN 100234567800003',
      currency: 'AED',
      taxRegime: 'VAT',
      invoiceTitle: 'Tax Invoice',
      taxNote: 'Prices include 5% VAT',
      taxRates: [{ name: 'VAT 5%', percent: 5 }],
    });
    // An Indian entity with no profile keeps GSTIN and rupees; "no tax" prints no tax number at all.
    await ok(
      w.api.patch(`/api/branches/entities/${g.entity.id}`, {
        name: 'GGM Hotels Rajasthan',
        taxId: '08AAAAA0000A1Z5',
      }),
    );
    expect(await letterheadOf(ctx.prisma, w.companyId, g.b.rooftop.id)).toMatchObject({
      tax: 'GSTIN 08AAAAA0000A1Z5',
      currency: 'INR',
      taxRegime: null,
    });
    await ok(
      w.api.patch(`/api/branches/entities/${g.entity.id}`, {
        name: 'GGM Hotels Rajasthan',
        details: { tax: { regime: 'NONE' } },
      }),
    );
    expect((await letterheadOf(ctx.prisma, w.companyId, g.b.rooftop.id)).tax).toBeNull();

    // A paper from Dubai: its total is in dirhams, and its texts can use the tax number and the legal line.
    await ok(
      w.api.put('/api/document-types', {
        code: 'INV',
        name: 'Invoice',
        prefix: 'INV',
        series: 'entity',
        header: '{{tax}}',
        footer: '{{tax.note}} — total {{total}}',
      }),
    );
    const cashier = await g.at('Cashier Marina', marina.id, 'HOD');
    const flowId = await publish(w.api, 'Billing', {
      startFields: [
        { key: 'guest', label: 'Guest', type: 'text', required: true },
        { key: 'items', label: 'Items', type: 'items' },
      ],
      steps: [{ ...task('bill', w.owner.id), documents: ['INV'] }],
    });
    const rec = (
      await start(cashier.api, flowId, {
        guest: 'Walk-in',
        items: [{ item: 'Dinner', qty: 2, rate: 150, amount: 300 }],
      })
    ).body as { id: string };
    const step = await ctx.prisma.fmsRecordStep.findFirstOrThrow({
      where: { recordId: rec.id, status: 'OPEN' },
    });
    await ok(w.api.post(`/api/fms/steps/${step.id}/complete`, { data: {} }));
    const inv = await ctx.prisma.document.findFirstOrThrow({
      where: { recordId: rec.id },
      include: { type: true },
    });
    expect(inv.number).toMatch(/^INV\/DXB\//);
    const { documentPdf, paperTexts } = await import('../fms/documents');
    const company = await ctx.prisma.company.findUniqueOrThrow({ where: { id: w.companyId } });
    const texts = await paperTexts(
      ctx.prisma,
      inv,
      company,
      new Map(),
      await letterheadOf(ctx.prisma, w.companyId, inv.branchId),
    );
    expect(texts.header).toBe('TRN 100234567800003');
    expect(texts.footer).toBe('Prices include 5% VAT — total AED 300.00');
    expect((await documentPdf(ctx.prisma, w.companyId, inv.id)).pdf.subarray(0, 4).toString()).toBe('%PDF');
    void rooftop;
  });
});
