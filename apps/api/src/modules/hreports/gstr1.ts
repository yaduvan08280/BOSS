import type { Db } from '@mono/db';
import { GSTIN, gstinState, stateCode, type BillChargeOut, type BillLineOut, csvCell } from '@mono/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { afterId, paged } from '../../lib/paged';
import { can, type Actor } from '../work/actor';

/**
 * Phase 20 — the month's outward supplies for GSTR-1, worked out from the bills: B2B invoices line by rate,
 * sales to unregistered buyers by place of supply and rate, credit and debit notes to registered buyers, the
 * HSN summary and the documents issued. It is a working file for the accountant (CSV) — not the portal's own
 * upload format, and it files nothing.
 */
export const gstrQuery = z.object({
  /** YYYY-MM */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** The legal entity (a GSTIN); left out, the company's own bills. */
  entityId: z.string().max(40).optional(),
});
type Tax = { name: string; percent: number; amount: number };
const split = (taxes: Tax[] | undefined) => {
  const of = (re: RegExp) => (taxes ?? []).filter((t) => re.test(t.name)).reduce((n, t) => n + t.amount, 0);
  return { igst: of(/^IGST/i), cgst: of(/^CGST/i), sgst: of(/^(SGST|UTGST)/i) };
};

export async function gstr1(db: Db, actor: Actor, input: z.input<typeof gstrQuery>) {
  if (!can(actor, 'money.view')) throw new AppError(403, 'FORBIDDEN', "You can't see bills");
  const q = gstrQuery.parse(input);
  const entity = q.entityId
    ? await db.legalEntity.findFirst({ where: { id: q.entityId, companyId: actor.companyId } })
    : null;
  if (q.entityId && !entity) throw new AppError(404, 'NOT_FOUND', 'Legal entity not found');
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { gstin: true, state: true },
  });
  const sellerState =
    gstinState(entity ? entity.taxId : company.gstin) ?? stateCode(entity ? entity.state : company.state);
  // A busy month is tens of thousands of bills: they are read a page at a time (never the whole month in
  // memory), and the server answers other people between pages.
  const where = {
    companyId: actor.companyId,
    entityId: q.entityId ?? null,
    type: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] },
    status: { in: ['ISSUED', 'PART_PAID', 'PAID'] },
    date: { gte: `${q.month}-01`, lte: `${q.month}-31` },
  };
  const pages = paged(
    (after, take) =>
      db.bill.findMany({
        where: { ...where, ...afterId(after) },
        select: {
          id: true,
          number: true,
          type: true,
          date: true,
          total: true,
          partyId: true,
          lines: true,
          charges: true,
        },
        orderBy: { id: 'asc' },
        take,
      }),
    1000,
  );
  type BillRow = Awaited<ReturnType<typeof pages.next>>['value'] & object;
  const parties = new Map<string, { taxId: string | null; name: string; state: string | null } | null>();
  const partyOf = async (id: string) => {
    if (!parties.has(id))
      parties.set(
        id,
        await db.party.findFirst({
          where: { id, companyId: actor.companyId },
          select: { taxId: true, name: true, state: true },
        }),
      );
    return parties.get(id);
  };
  type Part = {
    percent: number;
    taxable: number;
    igst: number;
    cgst: number;
    sgst: number;
    hsn: string;
    qty: number;
  };
  const partsOf = (b: BillRow): Part[] => [
    ...(b.lines as unknown as BillLineOut[]).map((l) => ({
      percent: l.taxPercent,
      taxable: l.taxable,
      ...split(l.taxes as Tax[]),
      hsn: l.hsn ?? '',
      qty: l.qty,
    })),
    ...(b.charges as unknown as BillChargeOut[]).map((c) => ({
      percent: c.taxPercent,
      taxable: c.taxable,
      ...split(c.taxes as Tax[]),
      hsn: '',
      qty: 0,
    })),
  ];
  type Row = Record<string, unknown>;
  /** Add amounts to the row of a key (made from `base` the first time). */
  const add = (map: Map<string, Row>, key: string, base: Row, n: Record<string, number>) => {
    const row = map.get(key) ?? { ...base, ...Object.fromEntries(Object.keys(n).map((k) => [k, 0])) };
    for (const k of Object.keys(n)) row[k] = Number(row[k] ?? 0) + n[k]!;
    map.set(key, row);
  };
  const b2b = new Map<string, Row>();
  const b2cs = new Map<string, Row>();
  const cdnr = new Map<string, Row>();
  const hsn = new Map<string, Row>();
  const problems = new Set<string>();
  // The documents issued: how many, and the first and last invoice of the month (by date, then number).
  let invoices = 0;
  let notes = 0;
  let first: BillRow | null = null;
  let last: BillRow | null = null;
  const earlier = (x: BillRow, y: BillRow) => (x.date === y.date ? x.number! < y.number! : x.date < y.date);
  for await (const b of pages) {
    if (b.type === 'INVOICE') {
      invoices += 1;
      if (!first || earlier(b, first)) first = b;
      if (!last || earlier(last, b)) last = b;
    } else notes += 1;
    const party = await partyOf(b.partyId);
    const registered = Boolean(party?.taxId && GSTIN.test(party.taxId));
    const pos = (registered ? gstinState(party!.taxId) : stateCode(party?.state)) ?? sellerState ?? '';
    const sign = b.type === 'CREDIT_NOTE' ? -1 : 1;
    for (const p of partsOf(b)) {
      const sums = { taxable: p.taxable, igst: p.igst, cgst: p.cgst, sgst: p.sgst };
      if (b.type === 'INVOICE' && registered)
        add(
          b2b,
          `${b.number}|${p.percent}`,
          {
            gstin: party!.taxId,
            name: party!.name,
            number: b.number,
            date: b.date,
            value: Number(b.total),
            pos,
            rate: p.percent,
          },
          sums,
        );
      else if (b.type === 'INVOICE') add(b2cs, `${pos}|${p.percent}`, { pos, rate: p.percent }, sums);
      else if (registered)
        add(
          cdnr,
          `${b.number}|${p.percent}`,
          {
            gstin: party!.taxId,
            name: party!.name,
            number: b.number,
            date: b.date,
            kind: b.type === 'CREDIT_NOTE' ? 'C' : 'D',
            value: Number(b.total),
            pos,
            rate: p.percent,
          },
          sums,
        );
      else
        // A note to an unregistered buyer lowers (or raises) that month's B2C sales.
        add(
          b2cs,
          `${pos}|${p.percent}`,
          { pos, rate: p.percent },
          {
            taxable: sign * p.taxable,
            igst: sign * p.igst,
            cgst: sign * p.cgst,
            sgst: sign * p.sgst,
          },
        );
      if (b.type === 'INVOICE') {
        if (!p.hsn && p.taxable > 0 && problems.size < 200)
          problems.add(`${b.number}: a line has no HSN / SAC code`);
        add(hsn, `${p.hsn}|${p.percent}`, { hsn: p.hsn, rate: p.percent }, { qty: p.qty, ...sums });
      }
    }
  }
  const list = (m: Map<string, Row>) => [...m.values()];
  // Invoice by invoice in the order they were issued (pages come in id order).
  const inOrder = (rows: Row[]) =>
    rows.sort(
      (x, y) =>
        String(x.date).localeCompare(String(y.date)) || String(x.number).localeCompare(String(y.number)),
    );
  /** Summary rows in a fixed order: by place of supply (or HSN code), then by rate. */
  const byKey = (rows: Row[], key: string) =>
    rows.sort((x, y) => String(x[key]).localeCompare(String(y[key])) || Number(x.rate) - Number(y.rate));
  return {
    month: q.month,
    gstin: entity ? entity.taxId : company.gstin,
    b2b: inOrder(list(b2b)),
    b2cs: byKey(list(b2cs), 'pos'),
    cdnr: inOrder(list(cdnr)),
    hsn: byKey(list(hsn), 'hsn'),
    docs: { invoices, from: first?.number ?? null, to: last?.number ?? null, notes },
    problems: [...problems],
  };
}

const rs = (minor: unknown) => (Number(minor ?? 0) / 100).toFixed(2);
const cell = (v: unknown) => csvCell(v);
/** The same as one CSV file, a section after another, amounts in rupees. */
export async function gstr1Csv(db: Db, actor: Actor, input: z.input<typeof gstrQuery>) {
  const r = await gstr1(db, actor, input);
  const money = ['value', 'taxable', 'igst', 'cgst', 'sgst'];
  const section = (title: string, cols: string[], rows: object[]) => [
    title,
    cols.join(','),
    ...rows.map((row) =>
      cols
        .map((c) =>
          cell(
            money.includes(c) ? rs((row as Record<string, unknown>)[c]) : (row as Record<string, unknown>)[c],
          ),
        )
        .join(','),
    ),
    '',
  ];
  const lines = [
    `GSTR-1 working file,${r.gstin ?? ''},${r.month}`,
    '',
    ...section(
      'B2B',
      ['gstin', 'name', 'number', 'date', 'value', 'pos', 'rate', 'taxable', 'igst', 'cgst', 'sgst'],
      r.b2b,
    ),
    ...section('B2CS', ['pos', 'rate', 'taxable', 'igst', 'cgst', 'sgst'], r.b2cs),
    ...section(
      'CDNR',
      ['gstin', 'name', 'number', 'date', 'kind', 'value', 'pos', 'rate', 'taxable', 'igst', 'cgst', 'sgst'],
      r.cdnr,
    ),
    ...section('HSN', ['hsn', 'rate', 'qty', 'taxable', 'igst', 'cgst', 'sgst'], r.hsn),
    'DOCS',
    'invoices,from,to,notes',
    [r.docs.invoices, r.docs.from ?? '', r.docs.to ?? '', r.docs.notes].map(cell).join(','),
  ];
  return { fileName: `gstr1-${r.month}.csv`, csv: lines.join('\n') };
}
