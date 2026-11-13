import type { PrismaClient } from '@mono/db';
import { gstinCheckDigit } from '@mono/shared';
import { ok } from '../../branches/testkit';
import type { world } from '../../records/testkit';

export { ok };
export type World = Awaited<ReturnType<typeof world>>;
export type Installed = { made: { kind: string; key: string }[]; kept: { kind: string; key: string }[] };
export const today = (plus = 0) =>
  new Date(Date.now() + plus * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * A trade's company for its scripted day: the pack installed from the library into an empty company, with what
 * a test needs to find its things again — record types by prefix, items by code, masters and processes by name
 * — and the few calls every trade makes: buy and receive, bill, take money, look at what is owed.
 */
export async function trade(prisma: PrismaClient, w: World, key: string) {
  // Company Setup → Company profile: the state and GSTIN decide how a bill is taxed.
  const first14 = '08AAACM1234A1Z';
  await ok(
    w.api.put('/api/org/company', {
      name: `${key} trading`,
      city: 'Jaipur',
      state: 'Rajasthan',
      ownerName: 'Test Owner',
      mobile: '9829000000',
      gstin: `${first14}${gstinCheckDigit(first14)}`,
    }),
  );
  const installed = await ok<Installed>(w.api.post(`/api/packs/library/${key}`));
  const companyId = w.companyId;
  const types = (await ok<{ types: { id: string; prefix: string }[] }>(w.api.get('/api/records/types')))
    .types;
  const type = (prefix: string) => types.find((t) => t.prefix === prefix)!.id;
  const items = new Map((await prisma.item.findMany({ where: { companyId } })).map((i) => [i.code, i.id]));
  const item = (code: string) => items.get(code)!;
  const flow = async (name: string) =>
    (await prisma.flow.findFirstOrThrow({ where: { companyId, name } })).id;
  const report = async (name: string) =>
    (await prisma.report.findFirstOrThrow({ where: { companyId, name } })).id;
  /** The accountant types the rate of a tax code the pack left at 0 %. */
  const rate = (code: string, percent: number) =>
    ok(w.api.put('/api/money/tax-rates', { code, name: code, percent, from: '2020-01-01' }));
  const party = (name: string, kinds: string[], more: object = {}) =>
    ok<{ id: string }>(w.api.post('/api/money/parties', { name, kinds, state: 'Rajasthan', ...more })).then(
      (p) => p.id,
    );
  const cash = await ok<{ id: string }>(w.api.post('/api/money/modes', { name: 'Cash', kind: 'CASH' }));
  const vendors = new Map<string, string>();
  /** An order to a vendor, sent, and received in full with the vendor's bill raised. */
  const buy = async (
    vendor: string,
    lines: { code: string; qty: number; ratePaise: number; batch?: object; serials?: object[] }[],
  ) => {
    // The typed vendor name is matched to a party once; later orders find it.
    if (!vendors.has(vendor)) {
      const id = await party(`${vendor} Pvt Ltd`, ['vendor']);
      await ok(w.api.post('/api/money/vendors/match', { name: vendor, partyId: id }));
      vendors.set(vendor, id);
    }
    const vendorId = vendors.get(vendor)!;
    const po = await ok<{ id: string; number: string }>(
      w.api.post('/api/ims/po', {
        vendor,
        lines: lines.map((l) => ({ itemId: item(l.code), qty: l.qty, ratePaise: l.ratePaise })),
      }),
    );
    await ok(w.api.post(`/api/ims/po/${po.id}/send`, {}));
    const grn = await ok<{ id: string; billId: string; poStatus: string }>(
      w.api.post('/api/ims/grn', {
        poId: po.id,
        invoiceNo: `${vendor.slice(0, 3).toUpperCase()}/1`,
        invoiceDate: today(),
        raiseBill: true,
        lines: lines.map((l) => ({
          itemId: item(l.code),
          qty: l.qty,
          ratePaise: l.ratePaise,
          ...(l.batch ? { batch: l.batch } : {}),
          ...(l.serials ? { serials: l.serials } : {}),
        })),
      }),
    );
    return { vendorId, po, grn };
  };
  const stock = async (code: string) =>
    Number((await prisma.item.findUniqueOrThrow({ where: { id: item(code) } })).stock);
  type Sale = {
    billId: string;
    number: string;
    total: number;
    lines: { rate: number; source: string; batch: string | null; qty: number }[];
  };
  const sell = (body: object) => w.api.post('/api/ims/sell', body);
  const sold = (body: object) => ok<Sale>(sell(body));
  /** An invoice made and issued in Money (a service, a milestone, a freight bill). */
  const invoice = async (partyId: string, lines: object[], more: object = {}) => {
    const d = await ok<{ id: string }>(
      w.api.post('/api/money/bills', {
        type: 'INVOICE',
        partyId,
        date: today(),
        branchId: null,
        lines,
        ...more,
      }),
    );
    await ok(w.api.post(`/api/money/bills/${d.id}/issue`));
    return d.id;
  };
  const receipt = (partyId: string, amount: number) =>
    ok<{ id: string }>(
      w.api.post('/api/money/bills', {
        type: 'RECEIPT',
        partyId,
        date: today(),
        branchId: null,
        amount,
        modeId: cash.id,
      }),
    );
  type Owed = { rows: { party: { id: string; name: string }; due: number; overdue: number }[] };
  const owed = (side = 'receivable') => ok<Owed>(w.api.get(`/api/money/outstanding?side=${side}`));
  type Rec = { id: string; code: string; status: string; data: Record<string, unknown> };
  const record = (prefix: string, data: object, lines?: object) =>
    w.api.post(`/api/records/types/${type(prefix)}/records`, { data, ...(lines ? { lines } : {}) });
  const read = async (id: string) =>
    (await ok<{ record: Rec }>(w.api.get(`/api/records/entries/${id}`))).record;
  /** A record made, read back with what MONO worked out (formulas, links). */
  const made = async (prefix: string, data: object, lines?: object) => {
    const r = await ok<{ id: string }>(record(prefix, data, lines));
    return read(r.id);
  };
  const moveTo = async (id: string, action: string) => {
    await ok(w.api.post(`/api/records/entries/${id}/move`, { action }));
    return read(id);
  };
  type Ran = { result: { rows: (string | number | null)[][]; total: number } };
  const run = async (name: string) =>
    (await ok<Ran>(w.api.get(`/api/reports/${await report(name)}/run`))).result;
  /** A photo uploaded as proof (the file itself is not read by these tests). */
  const proof = async () =>
    (
      await prisma.attachment.create({
        data: {
          companyId,
          entityType: 'upload',
          entityId: 'day',
          path: `day/${Date.now()}.jpg`,
          originalName: 'proof.jpg',
          mime: 'image/jpeg',
          size: 1,
          uploadedById: w.owner.id,
        },
      })
    ).id;
  /** Start a record of a process and do every step in turn (ticking any checklist, with a proof where asked). */
  const through = async (name: string, data: object, stepData: Record<string, object> = {}) => {
    const id = await flow(name);
    const rec = await ok<{ id: string }>(w.api.post(`/api/fms/flows/${id}/records`, { data }));
    for (let i = 0; i < 20; i++) {
      const r = await ok<{
        status: string;
        steps: { id: string; stepKey: string; status: string; checklist?: string[] }[];
      }>(w.api.get(`/api/fms/records/${rec.id}`));
      const open = r.steps.find((s) => s.status === 'OPEN');
      if (!open) return r.status;
      const def = (
        await prisma.flowVersion.findFirstOrThrow({ where: { flowId: id }, orderBy: { version: 'desc' } })
      ).definition as {
        steps: { key: string; checklist?: string[]; proofRequired?: boolean }[];
      };
      const step = def.steps.find((s) => s.key === open.stepKey)!;
      const done = await w.api.post(`/api/fms/steps/${open.id}/complete`, {
        checklistDone: step.checklist ?? [],
        data: stepData[open.stepKey] ?? {},
        ...(step.proofRequired ? { attachmentIds: [await proof()] } : {}),
      });
      if (done.status !== 200)
        throw new Error(`${open.stepKey}: ${done.status} ${JSON.stringify(done.body)}`);
    }
    return 'RUNNING';
  };
  /** The owner's week: the Weekly MIS answers for this company. */
  const mis = () => ok<{ rows: { name: string }[] }>(w.api.get('/api/mis'));
  return {
    w,
    installed,
    type,
    item,
    flow,
    rate,
    party,
    cash: cash.id,
    buy,
    stock,
    sell,
    sold,
    invoice,
    receipt,
    owed,
    record,
    made,
    moveTo,
    run,
    through,
    mis,
    companyId,
  };
}
export type Trade = Awaited<ReturnType<typeof trade>>;

/** Daily checklists a pack makes would be swept for ever in the test database: switch this company's off. */
export const quiet = (prisma: PrismaClient, companyId: string) =>
  prisma.checklistMaster.updateMany({ where: { companyId, active: true }, data: { active: false } });
