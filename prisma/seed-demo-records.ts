import type { Db } from '@mono/db';
import { actorFor, createRecord, createRecordType, moveRecord, saveReport } from '@mono/api/services';
import { addDays, localDate } from '@mono/shared';

/** [site, customer index, days ago, kind, cost ₹, how far it went] */
type Visit = [
  string,
  number,
  number,
  'Survey' | 'Repair' | 'Installation',
  number,
  'planned' | 'visited' | 'approved',
];

const VISITS: Visit[] = [
  ['Tonk mine office', 0, 82, 'Survey', 1800, 'approved'],
  ['Niwai factory gate', 1, 75, 'Repair', 6500, 'approved'],
  ['Kishangarh showroom', 2, 68, 'Installation', 24000, 'approved'],
  ['Jaipur site — Vaishali Nagar', 3, 61, 'Survey', 1200, 'approved'],
  ['Ajmer warehouse', 0, 54, 'Repair', 4300, 'approved'],
  ['Tonk mine office', 4, 47, 'Installation', 31500, 'approved'],
  ['Udaipur villa project', 5, 40, 'Survey', 2600, 'approved'],
  ['Niwai factory gate', 1, 33, 'Repair', 5200, 'visited'],
  ['Kishangarh showroom', 2, 26, 'Installation', 18750, 'approved'],
  ['Jaipur site — Mansarovar', 3, 19, 'Survey', 1500, 'visited'],
  ['Ajmer warehouse', 0, 12, 'Repair', 3900, 'visited'],
  ['Udaipur villa project', 5, 6, 'Installation', 27200, 'planned'],
  ['Tonk mine office', 4, 3, 'Survey', 1400, 'planned'],
  ['Jodhpur dealer yard', 1, 1, 'Survey', 2100, 'planned'],
];

/**
 * Phase 11 demo data: a "Site visit" record type (a company's own thing, set up without code) with reportable
 * fields, 14 visits over three months linked to demo customers, and two saved reports. Added once.
 */
export async function seedDemoRecords(db: Db, companyId: string): Promise<boolean> {
  if (await db.recordType.count({ where: { companyId } })) return false;
  const owner = await db.user.findFirst({
    where: { companyId, role: { key: 'OWNER' } },
    select: { id: true },
  });
  const actor = owner ? await actorFor(db, companyId, owner.id) : null;
  if (!actor) return false;
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const today = localDate(new Date(), company.timezone);
  const customers = await db.customer.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { code: 'asc' },
    take: 6,
    select: { id: true, name: true },
  });

  const type = await createRecordType(db, actor, {
    name: 'Site visit',
    pluralName: 'Site visits',
    prefix: 'SV',
    description: 'A visit to a customer site: what was planned, what was found, what it cost',
    definition: {
      fields: [
        { key: 'site', label: 'Site', type: 'text', required: true, reportable: true },
        {
          key: 'customer',
          label: 'Customer',
          type: 'master',
          master: 'customers',
          required: false,
          reportable: true,
        },
        { key: 'visit_on', label: 'Visit on', type: 'date', required: true, reportable: true },
        {
          key: 'kind',
          label: 'Kind of visit',
          type: 'dropdown',
          options: ['Survey', 'Repair', 'Installation'],
          required: true,
          reportable: true,
        },
        { key: 'cost', label: 'Cost', type: 'amount', required: false, reportable: true },
        { key: 'remarks', label: 'Remarks', type: 'longtext', required: false },
      ],
      tables: [
        {
          key: 'findings',
          label: 'Findings',
          fields: [
            { key: 'what', label: 'What was found', type: 'text', required: true },
            { key: 'qty', label: 'Qty', type: 'number', required: false },
          ],
        },
      ],
      statuses: [
        { key: 'planned', label: 'Planned', kind: 'info' },
        { key: 'visited', label: 'Visited', kind: 'warn' },
        { key: 'approved', label: 'Approved', kind: 'ok', final: true },
        { key: 'cancelled', label: 'Cancelled', kind: 'neutral', final: true },
      ],
      start: 'planned',
      displayField: 'site',
      moves: [
        { from: 'planned', action: 'visit', label: 'Mark visited', to: 'visited', who: ['edit', 'creator'] },
        { from: 'visited', action: 'approve', label: 'Approve', to: 'approved', who: ['approve'] },
        {
          from: 'visited',
          action: 'send_back',
          label: 'Send back',
          to: 'planned',
          who: ['approve'],
          noteRequired: true,
        },
        {
          from: 'planned',
          action: 'cancel',
          label: 'Cancel',
          to: 'cancelled',
          who: ['creator'],
          noteRequired: true,
        },
      ],
    },
    menu: { section: 'systems', icon: 'map-pin' },
  });

  for (const [site, c, ago, kind, cost, upTo] of VISITS) {
    const customer = customers[c % Math.max(1, customers.length)];
    const rec = await createRecord(db, actor, type.id, {
      data: {
        site,
        visit_on: addDays(today, -ago),
        kind,
        cost,
        ...(customer ? { customer: customer.name, _refs: { customer: `customer:${customer.id}` } } : {}),
      },
      lines: {
        findings:
          kind === 'Repair'
            ? [
                { what: 'Chipped slab edge', qty: 2 },
                { what: 'Loose joint sealant', qty: 1 },
              ]
            : [],
      },
    });
    if (upTo !== 'planned') await moveRecord(db, actor, rec.id, { action: 'visit' });
    if (upTo === 'approved') await moveRecord(db, actor, rec.id, { action: 'approve' });
  }

  const source = { kind: 'recordType' as const, id: type.id };
  await saveReport(db, actor, {
    name: 'Site visits by month',
    definition: {
      source,
      columns: [],
      filters: [],
      groupBy: { field: 'visit_on', bucket: 'month' },
      measures: [{ fn: 'count' }, { fn: 'sum', field: 'cost' }],
      look: 'bar',
    },
  });
  await saveReport(db, actor, {
    name: 'Visit cost by customer',
    definition: {
      source,
      columns: [],
      filters: [{ field: 'visit_on', op: 'this_fy' }],
      groupBy: { field: 'customer' },
      measures: [{ fn: 'sum', field: 'cost' }, { fn: 'count' }],
      look: 'table',
    },
  });
  return true;
}
