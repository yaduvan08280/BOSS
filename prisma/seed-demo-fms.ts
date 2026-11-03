import type { Db } from '@mono/db';
import { flowDefinitionSchema, type FlowDefinition } from '@mono/shared';

/**
 * Phase 5 demo data (CLAUDE.md §15): the 8 demo processes, published, with ~40 running records
 * (some late, a few closed) and 4 document types. Written straight to the tables, no events.
 */
type S = [
  key: string,
  name: string,
  type: 'TASK' | 'DECISION' | 'APPROVAL' | 'OUTSIDE' | 'AUTO',
  doer: string | null,
  hours: number,
  extra?: object,
];
type FlowSeed = {
  name: string;
  run: string;
  coord: string;
  solver?: string;
  video?: boolean;
  dept: string;
  steps: S[];
  draft?: boolean;
};

const start = [
  { key: 'customer', label: 'Customer', type: 'text', required: true },
  { key: 'mobile', label: 'Mobile', type: 'mobile' },
  { key: 'lines', label: 'Items', type: 'items' },
  { key: 'promised', label: 'Promised date', type: 'date' },
];

const FLOWS: FlowSeed[] = [
  {
    name: 'Sales Order to Dispatch',
    run: 'Order',
    coord: 'Rohit Mittal',
    solver: 'Mahesh Yadav',
    video: true,
    dept: 'Sales',
    steps: [
      [
        'confirm',
        'Confirm order with customer',
        'TASK',
        'Arjun Rawat',
        2,
        { checklist: ['Rate confirmed', 'Delivery date confirmed'] },
      ],
      ['stock', 'Material in stock?', 'DECISION', 'Gopal Prajapat', 4, { yes: 'pack', no: 'buy' }],
      ['buy', 'Buy material', 'TASK', 'Amit Khandelwal', 48],
      ['approve', 'Purchase approval', 'APPROVAL', 'Rajesh Goyal', 4, { rejectTo: 'buy' }],
      ['pack', 'Pack and label slabs', 'TASK', 'Deepak Saini', 8, { proofRequired: true }],
      [
        'dispatch',
        'Dispatch',
        'TASK',
        'Mahesh Yadav',
        4,
        { fields: [{ key: 'vehicle', label: 'Vehicle no.', type: 'text', required: true }] },
      ],
      ['invoice', 'Make invoice', 'AUTO', null, 0, { auto: { action: 'document', documentType: 'INV' } }],
      ['payment', 'Payment received', 'OUTSIDE', 'Suresh Agarwal', 240],
    ],
  },
  {
    name: 'Sales FMS',
    run: 'Enquiry',
    coord: 'Rohit Mittal',
    solver: 'Rohit Mittal',
    video: true,
    dept: 'Sales',
    steps: [
      ['call', 'Call the enquiry back', 'TASK', 'Arjun Rawat', 2],
      ['quote', 'Send quotation', 'TASK', 'Arjun Rawat', 8, { documents: ['QUO'] }],
      ['follow', 'Follow up on quotation', 'TASK', 'Arjun Rawat', 48],
      ['won', 'Order won?', 'DECISION', 'Rohit Mittal', 24, { yes: 'pi', no: 'end' }],
      ['pi', 'Send proforma invoice', 'TASK', 'Suresh Agarwal', 4, { documents: ['PI'] }],
      ['advance', 'Advance received', 'OUTSIDE', 'Pooja Jain', 72],
    ],
  },
  {
    name: 'Sales Desk FMS',
    run: 'Walk-in',
    coord: 'Rohit Mittal',
    dept: 'Sales',
    steps: [
      ['greet', 'Show samples and note need', 'TASK', 'Arjun Rawat', 1],
      ['quote', 'Give price on the spot', 'TASK', 'Rohit Mittal', 2],
      ['visit', 'Site visit if needed', 'TASK', 'Arjun Rawat', 24],
      ['decide', 'Customer decides', 'OUTSIDE', 'Arjun Rawat', 72],
      ['handover', 'Hand over to order desk', 'TASK', 'Sunita Bansal', 4],
    ],
  },
  {
    name: 'New Client Audit Project Onboarding',
    run: 'Client',
    coord: 'Neha Kapoor',
    solver: 'Rajesh Goyal',
    dept: 'Marketing',
    steps: [
      ['kyc', 'Collect GST and KYC', 'TASK', 'Pooja Jain', 24],
      ['credit', 'Credit check', 'TASK', 'Suresh Agarwal', 24],
      ['limit', 'Approve credit limit', 'APPROVAL', 'Rajesh Goyal', 8],
      ['master', 'Add to customer master', 'TASK', 'Sunita Bansal', 4],
      ['kit', 'Send sample kit', 'TASK', 'Ravi Kumar', 48],
      ['meet', 'Kick-off meeting', 'TASK', 'Neha Kapoor', 72],
      [
        'welcome',
        'Welcome message',
        'AUTO',
        null,
        0,
        { auto: { action: 'message', text: 'Welcome to Demo Industries! Your account is ready.' } },
      ],
    ],
  },
  {
    name: 'Order to Delivery',
    run: 'Delivery',
    coord: 'Vikram Singh',
    solver: 'Mahesh Yadav',
    video: true,
    dept: 'Logistics',
    steps: [
      ['plan', 'Plan the route', 'TASK', 'Vikram Singh', 4],
      ['truck', 'Book the truck', 'TASK', 'Ravi Kumar', 8],
      ['load', 'Load and photo', 'TASK', 'Mahesh Yadav', 4, { proofRequired: true }],
      ['transit', 'In transit', 'OUTSIDE', 'Vikram Singh', 48],
      ['pod', 'Proof of delivery', 'TASK', 'Ravi Kumar', 24, { proofRequired: true }],
      ['close', 'Close delivery', 'TASK', 'Vikram Singh', 4],
    ],
  },
  {
    name: 'End-to-End Pharma Sales Order Fulfilment',
    run: 'Pharma order',
    coord: 'Priya Sharma',
    solver: 'Ajay Meena',
    dept: 'Quality',
    steps: [
      ['po', 'Receive customer PO', 'TASK', 'Arjun Rawat', 4],
      ['spec', 'Check spec sheet', 'TASK', 'Priya Sharma', 8],
      ['plan', 'Production plan', 'TASK', 'Ajay Meena', 24],
      ['make', 'Production', 'TASK', 'Deepak Saini', 72],
      ['qc', 'QC passed?', 'DECISION', 'Harish Joshi', 8, { yes: 'coa', no: 'make' }],
      ['coa', 'Certificate of analysis', 'TASK', 'Priya Sharma', 8, { documents: ['DC'] }],
      ['pack', 'Pack to spec', 'TASK', 'Deepak Saini', 8],
      ['ship', 'Ship', 'TASK', 'Mahesh Yadav', 8],
      ['bill', 'Bill', 'TASK', 'Suresh Agarwal', 8, { documents: ['INV'] }],
    ],
  },
  {
    name: 'Returns & Complaints',
    run: 'Complaint',
    coord: 'Priya Sharma',
    solver: 'Ajay Meena',
    video: true,
    dept: 'Quality',
    steps: [
      ['log', 'Log the complaint', 'TASK', 'Sunita Bansal', 1],
      ['call', 'Call the customer', 'TASK', 'Arjun Rawat', 4],
      ['photos', 'Get photos', 'OUTSIDE', 'Arjun Rawat', 24],
      ['assess', 'Quality assessment', 'TASK', 'Priya Sharma', 24],
      ['valid', 'Complaint valid?', 'DECISION', 'Priya Sharma', 8, { yes: 'visit', no: 'reply' }],
      ['visit', 'Site visit', 'TASK', 'Harish Joshi', 48],
      ['root', 'Root cause', 'TASK', 'Ajay Meena', 24],
      ['offer', 'Offer a solution', 'TASK', 'Rohit Mittal', 8],
      ['approve', 'Approve the credit note', 'APPROVAL', 'Rajesh Goyal', 8],
      ['credit', 'Issue credit note', 'TASK', 'Suresh Agarwal', 8],
      ['replace', 'Send replacement', 'TASK', 'Mahesh Yadav', 48],
      ['reply', 'Reply to the customer', 'TASK', 'Sunita Bansal', 4],
      [
        'closed',
        'Closing message',
        'AUTO',
        null,
        0,
        { auto: { action: 'message', text: 'Your complaint is closed. Thank you for your patience.' } },
      ],
    ],
  },
  {
    name: 'Lead to Order Conversion',
    run: 'Lead',
    coord: 'Neha Kapoor',
    solver: 'Rohit Mittal',
    dept: 'Marketing',
    draft: true,
    steps: [
      ['capture', 'Capture the lead', 'TASK', 'Neha Kapoor', 1],
      ['qualify', 'Qualify', 'TASK', 'Arjun Rawat', 24],
      ['need', 'Need confirmed?', 'DECISION', 'Arjun Rawat', 8, { yes: 'meet', no: 'end' }],
      ['meet', 'First meeting', 'TASK', 'Arjun Rawat', 72],
      ['sample', 'Send samples', 'TASK', 'Ravi Kumar', 48],
      ['trial', 'Trial order', 'OUTSIDE', 'Arjun Rawat', 168],
      ['proposal', 'Proposal in person', 'TASK', 'Rohit Mittal', 72],
      ['nego', 'Negotiation', 'TASK', 'Rohit Mittal', 72],
      ['ok', 'Price approval', 'APPROVAL', 'Rajesh Goyal', 8],
      ['po', 'Get the PO', 'OUTSIDE', 'Rohit Mittal', 72],
      ['handover', 'Hand over to order desk', 'TASK', 'Sunita Bansal', 4],
      [
        'thanks',
        'Thank-you message',
        'AUTO',
        null,
        0,
        { auto: { action: 'message', text: 'Thank you for your order!' } },
      ],
    ],
  },
];

const CUSTOMERS = [
  'Sharma Builders',
  'Jaipur Granite House',
  'Mehta Interiors',
  'Agrawal Constructions',
  'Royal Kitchens',
  'Patel Developers',
  'Shree Ram Marbles',
  'Sunrise Homes',
  'Kota Stone Traders',
  'Vardhman Realty',
];

export async function seedDemoFms(db: Db, companyId: string) {
  if (await db.flow.count({ where: { companyId } })) return false;
  const people = await db.user.findMany({ where: { companyId }, select: { id: true, name: true } });
  const by = (n: string) => people.find((p) => p.name === n)?.id ?? people[0]!.id;
  const owner = (await db.user.findFirstOrThrow({ where: { companyId, code: 'EMP-001' } })).id;
  const H = 3_600_000;
  const now = Date.now();

  for (const [code, name, prefix] of [
    ['QUO', 'Quotation', 'QUO'],
    ['PI', 'Proforma invoice', 'PI'],
    ['DC', 'Certificate of analysis', 'COA'],
    ['INV', 'Tax invoice', 'INV'],
  ] as const)
    await db.documentType.create({
      data: {
        companyId,
        code,
        name,
        prefix,
        terms: 'Payment within 30 days. Subject to Jaipur jurisdiction.',
      },
    });

  let flowNo = 0;
  let c = 0;
  for (const f of FLOWS) {
    flowNo++;
    const def: FlowDefinition = flowDefinitionSchema.parse({
      timeModel: 'calendar',
      startFields: start,
      steps: f.steps.map(([key, name, type, doer, hours, extra]) => ({
        key,
        name,
        type,
        doerIds: doer ? [by(doer)] : [],
        ...(type === 'AUTO'
          ? {}
          : {
              time:
                hours >= 24 && hours % 24 === 0
                  ? { value: hours / 24, unit: 'days', anchor: 'previous' }
                  : { value: hours, unit: 'hours', anchor: 'previous' },
            }),
        ...extra,
      })),
    });
    const dept = await db.department.findFirst({ where: { companyId, name: f.dept }, select: { id: true } });
    const flow = await db.flow.create({
      data: {
        companyId,
        code: `PRC-${String(flowNo).padStart(3, '0')}`,
        name: f.name,
        runName: f.run,
        departmentIds: dept ? [dept.id] : [],
        coordinatorId: by(f.coord),
        solverId: f.solver ? by(f.solver) : null,
        videoUrl: f.video ? 'https://youtu.be/demo' : null,
        draft: def as object,
        status: f.draft ? 'DRAFT' : 'PUBLISHED',
        version: f.draft ? 0 : 1,
        dirty: Boolean(f.draft),
        createdById: owner,
      },
    });
    await db.kpiCard.createMany({
      data: [
        {
          companyId,
          flowId: flow.id,
          label: `${f.run}s this month`,
          source: 'count',
          aggregation: 'COUNT',
          period: 'MONTH',
          position: 0,
        },
        {
          companyId,
          flowId: flow.id,
          label: 'Value this month',
          source: 'start:lines',
          aggregation: 'TOTAL',
          period: 'MONTH',
          position: 1,
        },
      ],
    });
    if (f.draft) continue;
    const version = await db.flowVersion.create({
      data: { companyId, flowId: flow.id, version: 1, definition: def as object, publishedById: owner },
    });
    await db.flow.update({ where: { id: flow.id }, data: { currentVersionId: version.id } });

    // 5 records per flow: the main path walked to step k; a few late, one closed.
    const main: string[] = [];
    for (let k: string | undefined = def.steps[0]?.key, guard = 0; k && k !== 'end' && guard < 40; guard++) {
      main.push(k);
      const s = def.steps.find((x) => x.key === k)!;
      const i = def.steps.indexOf(s);
      k = s.type === 'DECISION' ? s.yes : (s.next ?? def.steps[i + 1]?.key);
    }
    for (let r = 0; r < 5; r++) {
      const customer = CUSTOMERS[c++ % CUSTOMERS.length]!;
      const closed = r === 4;
      const reach = closed ? main.length : Math.min(main.length - 1, r + 1);
      const late = r === 1 || (r === 3 && flowNo % 3 === 0);
      const startedAt = new Date(now - (reach * 10 + 6 + r * 7) * H);
      const lines = [
        {
          item: ['Statuario 20mm', 'Carrara 16mm', 'Calacatta Gold'][r % 3]!,
          qty: 8 + r * 3,
          rate: 3800 + r * 450,
          amount: (8 + r * 3) * (3800 + r * 450),
        },
      ];
      const rec = await db.fmsRecord.create({
        data: {
          companyId,
          flowId: flow.id,
          flowVersionId: version.id,
          number: r + 1,
          title: customer,
          data: {
            customer,
            mobile: `+9198290${String(10000 + c).slice(-5)}`,
            lines,
            promised: new Date(now + (10 + r) * 24 * H).toISOString().slice(0, 10),
          },
          status: closed ? 'CLOSED' : 'RUNNING',
          startedById: by(f.steps[0]![3] ?? f.coord),
          startedAt,
          closedAt: closed ? new Date(now - 2 * H) : null,
        },
      });
      await db.fmsRecordEvent.create({
        data: { companyId, recordId: rec.id, type: 'started', actorId: by(f.coord), createdAt: startedAt },
      });
      let t = startedAt.getTime();
      for (let i = 0; i < reach + (closed ? 0 : 1) && i < main.length; i++) {
        const s = def.steps.find((x) => x.key === main[i])!;
        const hours = s.time ? (s.time.unit === 'days' ? s.time.value * 24 : s.time.value) : 0;
        const open = !closed && i === reach;
        // Open steps are due later today/tomorrow unless this record is one of the late ones.
        const plannedAt = open ? new Date(late ? now - (3 + r) * H : Math.max(t + hours * H, now + (2 + r * 5) * H)) : new Date(t + hours * H);
        const doneAt = open ? null : new Date(Math.min(now - H, t + hours * H * (r % 2 ? 1.3 : 0.8)));
        await db.fmsRecordStep.create({
          data: {
            companyId,
            recordId: rec.id,
            stepKey: s.key,
            stepName: s.name,
            type: s.type,
            position: def.steps.indexOf(s),
            doerId: s.doerIds[0] ?? null,
            startedAt: new Date(t),
            plannedAt,
            doneAt,
            status: open ? 'OPEN' : 'DONE',
            decision:
              !open && s.type === 'DECISION' ? 'yes' : !open && s.type === 'APPROVAL' ? 'approved' : null,
            lateNotifiedAt: open && late ? new Date(now - H) : null,
          },
        });
        if (doneAt) t = doneAt.getTime();
      }
    }
    await db.counter.upsert({
      where: { companyId_key_fy: { companyId, key: `fms:${flow.id}`, fy: '' } },
      create: { companyId, key: `fms:${flow.id}`, fy: '', value: 5 },
      update: { value: 5 },
    });
  }
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'flow', fy: '' } },
    create: { companyId, key: 'flow', fy: '', value: FLOWS.length },
    update: { value: FLOWS.length },
  });
  return true;
}
