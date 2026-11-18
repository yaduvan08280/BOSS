import type { Db } from '@mono/db';
import { formatMoney, type BillChargeOut, type BillLineOut, type BillType, type TaxPart } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { renderPdf } from '../../lib/pdf';
import { letterheadOf } from '../branches/letterhead';
import type { Actor } from '../work/actor';
import { getBill } from './bills-read';

const TITLES: Record<BillType, string> = {
  INVOICE: 'Tax invoice',
  CREDIT_NOTE: 'Credit note',
  DEBIT_NOTE: 'Debit note',
  RECEIPT: 'Receipt',
  ADVANCE: 'Advance receipt',
  PURCHASE_BILL: 'Purchase bill',
  VENDOR_PAYMENT: 'Payment voucher',
  CHALLAN: 'Delivery challan',
};
const MONEY_PAPERS: BillType[] = ['RECEIPT', 'ADVANCE', 'VENDOR_PAYMENT'];
const dmy = (day: string) => day.split('-').reverse().join('/');
const qty = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * A bill as a PDF: who it is from (the branch's letterhead), who it is for, its lines with HSN and tax, the
 * charges, each tax, the total, and what is paid and still due. A draft has no number and is not printed.
 */
export async function billPdf(db: Db, actor: Actor, id: string): Promise<{ pdf: Buffer; name: string }> {
  const bill = await getBill(db, actor, id);
  if (bill.status === 'DRAFT')
    throw new AppError(400, 'BAD_REQUEST', 'Issue the bill first; a draft has no number');
  const [head, mode] = await Promise.all([
    letterheadOf(db, actor.companyId, bill.branchId),
    bill.modeId ? db.paymentMode.findFirst({ where: { id: bill.modeId, companyId: actor.companyId } }) : null,
  ]);
  const money = (n: number) => formatMoney(n, bill.currency);
  const type = bill.type as BillType;
  const title =
    bill.status === 'CANCELLED'
      ? `${TITLES[type]} (cancelled)`
      : type === 'INVOICE'
        ? head.invoiceTitle || (head.taxId ? TITLES.INVOICE : 'Invoice')
        : TITLES[type];
  const lines = (bill.lines ?? []) as unknown as BillLineOut[];
  const charges = (bill.charges ?? []) as unknown as BillChargeOut[];
  const taxes = (bill.taxes ?? []) as unknown as TaxPart[];
  const th = (text: string, right = false) => ({
    text,
    bold: true,
    fillColor: '#f2efe7',
    fontSize: 9,
    alignment: right ? 'right' : 'left',
  });
  const right = (text: string) => ({ text, alignment: 'right' });
  const total = (label: string, value: string, bold = false) => [
    { text: label, bold },
    { text: value, alignment: 'right', bold },
  ];

  const sums: unknown[][] = [];
  if (!MONEY_PAPERS.includes(type)) {
    sums.push(total('Before tax', money(bill.taxable)));
    for (const t of taxes) sums.push(total(`${t.name} ${t.percent}%`, money(t.amount)));
    if (bill.roundOff) sums.push(total('Round-off', money(bill.roundOff)));
  }
  sums.push(total(MONEY_PAPERS.includes(type) ? 'Amount' : 'Total', money(bill.total), true));
  if (bill.due > 0 || (bill.settled > 0 && !MONEY_PAPERS.includes(type))) {
    if (bill.settled + bill.credited > 0)
      sums.push(total('Paid / credited', money(bill.settled + bill.credited)));
    sums.push(total('Still due', money(bill.due), true));
  }

  const pdf = await renderPdf({
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 48],
    defaultStyle: { fontSize: 10 },
    footer: (page: number, pages: number) => ({
      text: [head.footer, `Page ${page} of ${pages}`].filter(Boolean).join('  ·  '),
      alignment: 'center',
      fontSize: 8,
      color: '#666',
      margin: [36, 16, 36, 0],
    }),
    content: [
      { text: head.name, fontSize: 15, bold: true },
      {
        text: [head.branch, head.branchAddress ?? head.address, head.phone, head.tax]
          .filter(Boolean)
          .join('  ·  '),
        color: '#555',
        fontSize: 9,
        margin: [0, 2, 0, 0],
      },
      ...(head.licences.length
        ? [
            {
              text: head.licences.map((l) => `${l.name} ${l.number}`).join('  ·  '),
              color: '#555',
              fontSize: 9,
            },
          ]
        : []),
      ...(head.header ? [{ text: head.header, fontSize: 9, margin: [0, 2, 0, 0] }] : []),
      { text: title, fontSize: 13, bold: true, alignment: 'center', margin: [0, 12, 0, 8] },
      {
        columns: [
          [
            { text: MONEY_PAPERS.includes(type) ? 'Party' : 'To', color: '#666', fontSize: 8 },
            { text: bill.party?.name ?? '', bold: true },
            ...(bill.party?.state ? [{ text: bill.party.state, fontSize: 9 }] : []),
            ...(bill.party?.taxId
              ? [{ text: `${head.tax?.split(' ')[0] ?? 'Tax no.'} ${bill.party.taxId}`, fontSize: 9 }]
              : []),
          ],
          {
            width: 190,
            table: {
              widths: [70, '*'],
              body: [
                ['No.', { text: bill.number ?? '', bold: true }],
                ['Date', dmy(bill.date)],
                ...(bill.dueOn ? [['Due on', dmy(bill.dueOn)]] : []),
                ...(mode ? [['Paid by', mode.name]] : []),
                ...(bill.reference ? [['Reference', bill.reference]] : []),
                ...(bill.einvoice ? [['IRN', { text: bill.einvoice.irn, fontSize: 6 }]] : []),
              ],
            },
            layout: 'noBorders',
          },
        ],
        margin: [0, 0, 0, 10],
      },
      ...(lines.length
        ? [
            {
              table: {
                headerRows: 1,
                widths: [16, '*', 44, 44, 60, 36, 66],
                body: [
                  [
                    th('#'),
                    th('Item'),
                    th('HSN'),
                    th('Qty', true),
                    th('Rate', true),
                    th('Tax', true),
                    th('Amount', true),
                  ],
                  ...lines.map((l, i) => [
                    String(i + 1),
                    l.item,
                    l.hsn ?? '',
                    right(`${qty(l.qty)}${l.unit ? ` ${l.unit}` : ''}`),
                    right(money(l.rate)),
                    right(l.taxPercent ? `${l.taxPercent}%` : ''),
                    right(money(l.taxable)),
                  ]),
                  ...charges.map((c) => [
                    '',
                    { text: c.name, italics: true },
                    '',
                    '',
                    '',
                    right(c.taxPercent ? `${c.taxPercent}%` : ''),
                    right(money(c.taxable)),
                  ]),
                ],
              },
              layout: 'lightHorizontalLines',
            },
          ]
        : []),
      {
        columns: [
          { text: bill.note ?? '', fontSize: 9, color: '#444', margin: [0, 10, 12, 0] },
          { width: 200, table: { widths: ['*', 80], body: sums }, layout: 'noBorders', margin: [0, 8, 0, 0] },
        ],
      },
      ...(head.taxNote ? [{ text: head.taxNote, fontSize: 8, color: '#666', margin: [0, 14, 0, 0] }] : []),
    ],
  });
  return { pdf, name: `${(bill.number ?? 'bill').replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
}
