import type { Db, Tx } from '@mono/db';
import { nextCounter } from '@mono/db';
import {
  financialYear,
  formatDate,
  formatINR,
  formatLocalDate,
  itemsTotal,
  type ItemLine,
} from '@mono/shared';
import { renderPdf } from '../../lib/pdf';
import { AppError } from '../../lib/errors';

/** QUO/26-27/0001 — numbered per document type, per financial year (CLAUDE.md §6.2 Documents). */
export async function createDocument(
  tx: Tx,
  input: {
    companyId: string;
    typeCode: string;
    recordId?: string | null;
    stepKey?: string | null;
    data: Record<string, unknown>;
    party?: string | null;
    createdById?: string | null;
    at?: Date;
  },
) {
  const type = await tx.documentType.findFirst({
    where: { companyId: input.companyId, code: input.typeCode, deletedAt: null, active: true },
  });
  if (!type)
    throw new AppError(400, 'VALIDATION_FAILED', `There is no active document type "${input.typeCode}"`);
  const company = await tx.company.findUniqueOrThrow({
    where: { id: input.companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  const date = input.at ?? new Date();
  const fy = financialYear(date, company.timezone, company.fyStartMonth ?? 4).short;
  const seq = await nextCounter(tx, input.companyId, `doc:${type.code}`, fy);
  const total = itemsTotal(input.data);
  return tx.document.create({
    data: {
      companyId: input.companyId,
      typeId: type.id,
      number: `${type.prefix}/${fy}/${String(seq).padStart(4, '0')}`,
      fy,
      seq,
      date,
      party: input.party ?? null,
      recordId: input.recordId ?? null,
      stepKey: input.stepKey ?? null,
      total: total === null ? null : total.toFixed(2),
      data: input.data as object,
      createdById: input.createdById ?? null,
    },
  });
}

const rupees = (n: number) => formatINR(BigInt(Math.round(n * 100)));

/** A clean A4 PDF of a document: company, number, party, item lines with totals, terms. */
export async function documentPdf(db: Db, companyId: string, id: string) {
  const doc = await db.document.findFirst({ where: { id, companyId }, include: { type: true } });
  if (!doc) throw new AppError(404, 'NOT_FOUND', 'Document not found');
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const data = doc.data as Record<string, unknown>;
  const lines = (Object.values(data).find(Array.isArray) as ItemLine[] | undefined) ?? [];
  const facts = Object.entries(data).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v));
  const pdf = await renderPdf({
    pageSize: 'A4',
    pageMargins: [36, 40, 36, 48],
    info: { title: doc.number },
    content: [
      {
        columns: [
          [
            { text: company.legalName || company.name, fontSize: 15, bold: true },
            { text: [company.city, company.state].filter(Boolean).join(', '), color: '#666' },
            company.gstin ? { text: `GSTIN ${company.gstin}`, color: '#666' } : '',
          ],
          [
            { text: doc.type.name.toUpperCase(), alignment: 'right', fontSize: 13, bold: true },
            { text: doc.number, alignment: 'right' },
            { text: formatDate(doc.date, company.timezone), alignment: 'right', color: '#666' },
            doc.status === 'CANCELLED'
              ? { text: 'CANCELLED', alignment: 'right', color: '#c0392b', bold: true }
              : '',
          ],
        ],
      },
      doc.type.header ? { text: doc.type.header, margin: [0, 12, 0, 0] } : '',
      doc.party ? { text: [{ text: 'To: ', bold: true }, doc.party], margin: [0, 14, 0, 6] } : '',
      facts.length
        ? {
            table: {
              widths: [140, '*'],
              // Dates as DD/MM/YYYY, never the stored YYYY-MM-DD.
              body: facts.map(([k, v]) => [
                { text: k, color: '#666' },
                typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
                  ? formatLocalDate(v)
                  : typeof v === 'boolean'
                    ? v
                      ? 'Yes'
                      : 'No'
                    : String(v),
              ]),
            },
            layout: 'noBorders',
            margin: [0, 6, 0, 10],
          }
        : '',
      lines.length
        ? {
            table: {
              headerRows: 1,
              widths: ['*', 50, 80, 90],
              body: [
                ['Item', 'Qty', 'Rate', 'Amount'].map((h) => ({ text: h, bold: true, fillColor: '#f2efe7' })),
                ...lines.map((l) => [
                  l.item,
                  String(l.qty),
                  rupees(l.rate),
                  { text: rupees(l.amount ?? l.qty * l.rate), alignment: 'right' },
                ]),
                [
                  { text: 'Total', bold: true, colSpan: 3 },
                  '',
                  '',
                  { text: rupees(Number(doc.total ?? 0)), bold: true, alignment: 'right' },
                ],
              ],
            },
            layout: 'lightHorizontalLines',
          }
        : '',
      doc.type.terms ? { text: doc.type.terms, fontSize: 8, color: '#666', margin: [0, 16, 0, 0] } : '',
      doc.type.footer ? { text: doc.type.footer, fontSize: 8, color: '#888', margin: [0, 8, 0, 0] } : '',
    ],
  });
  return { pdf, number: doc.number };
}
