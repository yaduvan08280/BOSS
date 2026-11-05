import type { Db } from '@mono/db';
import { actorFor, createOrder, generateCalls, syncAfterOrderFlow } from '@mono/api/services';
import { addDays, crmConfigSchema, financialYear, localDate, planInputSchema } from '@mono/shared';

const CR = 1_00_00_000_00;
const LAKH = 1_00_000_00;
/** [name, city, segment, average order ₹, every N days, usual day of month, last order N days ago, GP %, pays N days late, owner's?] */
type Spec = [string, string, string, number, number, number | null, number, number, number, boolean?];
const CUSTOMERS: Spec[] = [
  ['Shree Ram Tiles', 'Ajmer', 'dealer', 1_80_000, 20, null, 17, 22, 0],
  ['Marudhar Stone House', 'Jodhpur', 'distributor', 4_50_000, 30, 10, 26, 18, 0],
  ['Kishangarh Marble Mart', 'Kishangarh', 'dealer', 95_000, 12, null, 9, 24, 0],
  ['Jaipur Kitchen Studio', 'Jaipur', 'contractor', 2_40_000, 30, 5, 29, 28, 0],
  ['Royal Granite & Quartz', 'Udaipur', 'distributor', 6_20_000, 45, null, 41, 17, 0],
  ['Bansal Interiors', 'Jaipur', 'contractor', 1_20_000, 15, null, 13, 26, 0],
  ['Ajmer Building Solutions', 'Ajmer', 'dealer', 75_000, 7, null, 6, 21, 0],
  ['Shekhawati Stones', 'Sikar', 'dealer', 1_60_000, 28, 18, 14, 20, 0],
  ['Pink City Countertops', 'Jaipur', 'oem', 3_10_000, 21, null, 18, 25, 0],
  ['Mewar Marble Traders', 'Bhilwara', 'distributor', 5_40_000, 30, 25, 9, 12, 32],
  ['Agarwal Homes', 'Kota', 'contractor', 2_10_000, 35, null, 30, 23, 0],
  ['Desert Rose Interiors', 'Bikaner', 'dealer', 88_000, 18, null, 14, 27, 0],
  ['Goyal Constructions', 'Jaipur', 'contractor', 8_50_000, 40, null, 22, 19, 0, true],
  ['Lake City Quartz', 'Udaipur', 'dealer', 1_40_000, 25, null, 23, 22, 0],
  ['Nagaur Stone Works', 'Nagaur', 'dealer', 70_000, 14, null, 10, 24, 5],
  ['Sun City Surfaces', 'Jodhpur', 'oem', 2_80_000, 30, 1, 3, 21, 0],
  ['Aravali Builders', 'Alwar', 'contractor', 3_60_000, 45, null, 38, 18, 15],
  ['Hadoti Tiles Centre', 'Kota', 'dealer', 1_10_000, 20, null, 75, 22, 0],
  ['Malpura Marble', 'Tonk', 'dealer', 65_000, 15, null, 95, 25, 0],
  ['Pushkar Home Decor', 'Pushkar', 'retail', 45_000, 30, null, 130, 30, 0],
  ['Beawar Granite Hub', 'Beawar', 'dealer', 1_30_000, 25, null, 210, 20, 0],
  ['Chittor Stone Supply', 'Chittorgarh', 'distributor', 2_20_000, 30, null, 260, 16, 0],
  ['Rajasthan Housing Board', 'Jaipur', 'institution', 12_00_000, 90, null, 60, 14, 20, true],
  ['Niwai Ceramic Point', 'Niwai', 'dealer', 55_000, 10, null, 4, 26, 0],
];
const ITEMS = [
  'Quartz slab 15 mm',
  'Quartz slab 20 mm',
  'Kitchen countertop',
  'Vanity top',
  'Calacatta White',
  'Statuario',
  'Edge profiling',
  'Sink cut-out',
];

/**
 * Phase 9 demo (CLAUDE.md §15: "24 customers with order history for SCOT, 20 leads"): seats, rules and the
 * after-order flow; an approved FY plan of ₹7.5 Cr adding up to the rupee; 24 customers with 13 months of
 * orders and payments (every rhythm, sleeping, lost, a vampire, the owner's own); running orders on the kanban;
 * 20 leads through the funnel; today's calls. Added once.
 */
export async function seedDemoCrm(db: Db, companyId: string): Promise<boolean> {
  // Customers are the mark (settings and the plan are upserted, so a run that stopped half-way can go again).
  if (await db.customer.count({ where: { companyId } })) return false;
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  const tz = company.timezone;
  const today = localDate(new Date(), tz);
  const people = await db.user.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, name: true, role: { select: { key: true } } },
  });
  const id = (name: string) => people.find((p) => p.name === name)?.id;
  const ids = (...names: string[]) => names.map(id).filter((x): x is string => Boolean(x));
  const ownerId = people.find((p) => p.role.key === 'OWNER')!.id;
  const owner = (await actorFor(db, companyId, ownerId))!;

  const config = crmConfigSchema.parse({
    businessType: 'manufacturing',
    sellTo: ['b2b', 'dealers', 'government'],
    seats: {
      owner: [ownerId],
      crrSc: ids('Sunita Bansal'),
      osr: ids('Arjun Rawat'),
      crm: ids('Mahesh Yadav'),
      nbdSc: ids('Rohit Mittal'),
      salesRep: ids('Arjun Rawat'),
      marketing: ids('Neha Kapoor'),
      ea: ids('Anita Verma'),
      mis: ids('Pooja Jain'),
      pc: ids('Vikram Singh'),
      productionPc: ids('Ajay Meena'),
    },
    split: { crrPct: 50, gpFollows: true, ownerAmount: CR, seatWeights: {} },
    done: [
      'year',
      'quarters',
      'months',
      'weeks',
      'business',
      'sellTo',
      'seats',
      'split',
      'customerRules',
      'afterOrder',
      'nbd',
      'holidays',
      'weeklyOff',
      'seasons',
      'rounding',
    ],
  });
  await db.crmSettings.upsert({
    where: { companyId },
    create: { companyId, config: config as object },
    update: { config: config as object },
  });
  await syncAfterOrderFlow(db, owner, config);

  // The year plan: ₹5 Cr last year + 50% = ₹7.5 Cr, rounded to ₹10,000, monsoon slow and wedding season peak.
  const fy = financialYear(new Date(), tz, company.fyStartMonth ?? 4).start;
  const plan = planInputSchema.parse({
    lastTurnover: 5 * CR,
    lastGp: CR,
    growthPct: 50,
    quarterGrowthPct: [0, 5, 10, 5],
    roundUnit: 1_000_000,
    seasons: { peakPct: 40, goodPct: 15, slowPct: -20, peak: [10, 11, 12], good: [1, 2, 3], slow: [7, 8] },
  });
  const planRow = {
    companyId,
    fy,
    status: 'APPROVED',
    data: plan as object,
    submittedById: ownerId,
    submittedAt: new Date(),
    approvedById: ownerId,
    approvedAt: new Date(),
  };
  await db.crmPlan.upsert({ where: { companyId_fy: { companyId, fy } }, create: planRow, update: planRow });

  // 24 customers and 13 months of their orders and payments (a fixed pseudo-random sequence).
  let seed = 11;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const crrSc = id('Sunita Bansal') ?? null;
  const numbers = new Map<string, number>();
  const next = (date: string) => {
    const f = financialYear(new Date(`${date}T12:00:00Z`), tz, company.fyStartMonth ?? 4).short;
    const n = (numbers.get(f) ?? 0) + 1;
    numbers.set(f, n);
    return `SO/${f}/${String(n).padStart(4, '0')}`;
  };
  type OrderRow = {
    companyId: string;
    number: string;
    customerId: string;
    orderDate: string;
    dueOn: string;
    amount: bigint;
    gp: bigint;
    items: object;
    status: string;
    takenById: string | null;
  };
  const orders: OrderRow[] = [];
  const payments: {
    companyId: string;
    customerId: string;
    amount: bigint;
    date: string;
    mode: string;
    createdById: string | null;
  }[] = [];
  for (const [
    i,
    [name, city, segment, avg, every, usual, lastAgo, gpPct, late, owners],
  ] of CUSTOMERS.entries()) {
    const c = await db.customer.create({
      data: {
        companyId,
        code: `CUS-${String(i + 1).padStart(3, '0')}`,
        name,
        city,
        segment,
        mobile: `98290${String(10000 + i * 137).slice(-5)}`,
        handledById: owners ? ownerId : crrSc,
        creditDays: segment === 'institution' ? 45 : 30,
        ownerCustomer: Boolean(owners),
        lostAt: name === 'Chittor Stone Supply' ? new Date(Date.now() - 30 * 86_400_000) : null,
        lostReason: name === 'Chittor Stone Supply' ? 'Moved to a cheaper local brand' : null,
        fields: {},
        createdAt: new Date(Date.now() - 420 * 86_400_000),
      },
    });
    const dates: string[] = [];
    let d = addDays(today, -lastAgo);
    while (d >= addDays(today, -395)) {
      dates.unshift(
        usual
          ? `${d.slice(0, 8)}${String(Math.max(1, Math.min(usual + Math.round(rnd() * 2 - 1), 28))).padStart(2, '0')}`
          : d,
      );
      d = addDays(d, -(every + Math.round((rnd() - 0.5) * every * 0.3)));
    }
    for (const [k, date] of [...new Set(dates)].sort().entries()) {
      const amount = Math.round(avg * (0.8 + rnd() * 0.4)) * 100;
      const dueOn = addDays(date, segment === 'institution' ? 45 : 30);
      const pick = [
        ITEMS[(i + k) % ITEMS.length]!,
        ...(rnd() < 0.5 ? [ITEMS[(i + k + 3) % ITEMS.length]!] : []),
      ];
      orders.push({
        companyId,
        number: next(date),
        customerId: c.id,
        orderDate: date,
        dueOn,
        amount: BigInt(amount),
        gp: BigInt(Math.round((amount * gpPct) / 100)),
        items: pick.map((item) => ({ item, qty: 1 + Math.round(rnd() * 20), rate: Math.round(amount / 10) })),
        status: 'DONE',
        takenById: owners ? ownerId : crrSc,
      });
      // Paid after the due date + however late they pay; the newest stay open (some overdue).
      const paidOn = addDays(dueOn, late);
      if (paidOn <= addDays(today, -3) && !(late > 10 && k >= dates.length - 2))
        payments.push({
          companyId,
          customerId: c.id,
          amount: BigInt(amount),
          date: paidOn,
          mode: rnd() < 0.7 ? 'bank' : 'upi',
          createdById: id('Pooja Jain') ?? null,
        });
    }
  }
  await db.salesOrder.createMany({ data: orders });
  await db.payment.createMany({ data: payments });
  for (const [f, value] of numbers)
    await db.counter.upsert({
      where: { companyId_key_fy: { companyId, key: 'so', fy: f } },
      create: { companyId, key: 'so', fy: f, value },
      update: { value },
    });
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'customer', fy: '' } },
    create: { companyId, key: 'customer', fy: '', value: CUSTOMERS.length },
    update: { value: CUSTOMERS.length },
  });

  // Promises in the collections log.
  const cust = await db.customer.findMany({ where: { companyId }, select: { id: true, name: true } });
  const cid = (n: string) => cust.find((c) => c.name === n)!.id;
  await db.collectionNote.createMany({
    data: [
      {
        companyId,
        customerId: cid('Mewar Marble Traders'),
        kind: 'promise',
        note: 'Accounts will clear after the month end',
        promisedOn: addDays(today, 4),
        promisedAmount: BigInt(5 * LAKH),
        byId: id('Mahesh Yadav') ?? null,
      },
      {
        companyId,
        customerId: cid('Aravali Builders'),
        kind: 'promise',
        note: 'Cheque promised, not received',
        promisedOn: addDays(today, -3),
        byId: id('Mahesh Yadav') ?? null,
      },
      {
        companyId,
        customerId: cid('Rajasthan Housing Board'),
        kind: 'note',
        note: 'Bill passed by the engineer; with accounts',
        byId: ownerId,
      },
    ],
  });

  // Running orders on the kanban: three taken this week through the after-order flow.
  const sunita = (await actorFor(db, companyId, crrSc ?? ownerId))!;
  for (const [n, amt] of [
    ['Pink City Countertops', 3_20_000],
    ['Kishangarh Marble Mart', 1_10_000],
    ['Bansal Interiors', 1_40_000],
  ] as const) {
    await createOrder(
      db,
      { ...sunita, permissions: [...sunita.permissions, 'crm.create'] },
      {
        customerId: cid(n),
        amount: amt * 100,
        items: [{ item: 'Quartz slab 20 mm', qty: 10, rate: amt * 10 }],
        promisedOn: addDays(today, 4),
      },
    );
  }

  // 20 leads: enquiries to qualify, open leads across the stages (some stuck), won and lost.
  const rohit = id('Rohit Mittal') ?? ownerId;
  const L: [string, string | null, string, string, string, number, string, string | null, number][] = [
    ['Anil Jain', 'Jain Builders', 'Jaipur', 'Website', 'Quartz for 40 flats', 25, 'ENQUIRY', null, 1],
    [
      'Meera Shah',
      'Shah Kitchens',
      'Ahmedabad',
      'IndiaMART / portals',
      'Countertops, 15 a month',
      6,
      'ENQUIRY',
      null,
      0,
    ],
    [
      'Vijay Rathore',
      'Rathore Hotels',
      'Jaisalmer',
      'Reference',
      'Lobby and 60 bathrooms',
      18,
      'ENQUIRY',
      null,
      2,
    ],
    ['Sana Qureshi', null, 'Kota', 'Google / Meta ads', 'Home kitchen', 1.2, 'ENQUIRY', null, 0],
    [
      'Dinesh Kumar',
      'DK Infra',
      'Alwar',
      'Tender portal',
      'Government hostel tender',
      40,
      'ENQUIRY',
      null,
      3,
    ],
    [
      'Ritu Agarwal',
      'Agarwal Developers',
      'Jaipur',
      'Dream 100',
      'Township, 300 units',
      90,
      'OPEN',
      'contact',
      2,
    ],
    [
      'Karan Mehta',
      'Mehta Modular',
      'Udaipur',
      'Exhibition',
      'Modular kitchens dealer',
      12,
      'OPEN',
      'contact',
      6,
    ],
    ['Pooja Sharma', 'Elite Interiors', 'Jodhpur', 'Reference', 'Showroom tie-up', 8, 'OPEN', 'meeting', 4],
    ['Harish Gupta', 'Gupta Estates', 'Ajmer', 'Website', 'Villas, 24 units', 15, 'OPEN', 'meeting', 12],
    [
      'Neeraj Singh',
      'NS Hospitality',
      'Pushkar',
      'Google / Meta ads',
      'Resort renovation',
      22,
      'OPEN',
      'demo',
      5,
    ],
    [
      'Ankita Bhandari',
      'Bhandari Builders',
      'Bhilwara',
      'Dream 100',
      'Commercial complex',
      35,
      'OPEN',
      'demo',
      15,
    ],
    [
      'Faisal Khan',
      'Khan Marbles',
      'Makrana',
      'IndiaMART / portals',
      'Dealer for Makrana',
      9,
      'OPEN',
      'proposal',
      3,
    ],
    ['Sunil Choudhary', 'SC Projects', 'Sikar', 'Reference', 'School and hostel', 28, 'OPEN', 'proposal', 9],
    [
      'Rekha Joshi',
      'Joshi Kitchens',
      'Bikaner',
      'Exhibition',
      'Kitchen studio franchise',
      11,
      'OPEN',
      'negotiation',
      6,
    ],
    ['Amit Goel', 'Goel Group', 'Jaipur', 'Dream 100', 'Office tower lobby', 48, 'OPEN', 'negotiation', 14],
    [
      'Prakash Meena',
      'Meena Constructions',
      'Dausa',
      'Tender portal',
      'Panchayat bhawan',
      6,
      'OPEN',
      'contact',
      1,
    ],
    ['Lalit Bhatia', 'Bhatia Homes', 'Jaipur', 'Website', 'Show flats', 4, 'WON', 'negotiation', 20],
    ['Gaurav Arora', 'Arora Interiors', 'Ajmer', 'Reference', 'Clinic fit-out', 3, 'WON', 'proposal', 30],
    ['Manoj Saini', 'Saini Builders', 'Tonk', 'Google / Meta ads', 'Row houses', 7, 'LOST', 'proposal', 25],
    ['Ishita Kapoor', 'IK Designs', 'Jaipur', 'Website', 'Boutique hotel', 10, 'LOST', 'meeting', 40],
  ];
  for (const [i, [name, comp, city, source, req, lakh, status, stage, daysAgo]] of L.entries()) {
    const at = new Date(Date.now() - daysAgo * 86_400_000);
    const lead = await db.lead.create({
      data: {
        companyId,
        number: i + 1,
        name,
        company: comp,
        mobile: `97830${String(20000 + i * 211).slice(-5)}`,
        city,
        source,
        requirement: req,
        value: BigInt(Math.round(lakh * LAKH)),
        status,
        stage: status === 'ENQUIRY' ? null : stage,
        stageSince: at,
        ownerId: rohit,
        qualify: status === 'ENQUIRY' ? {} : Object.fromEntries(config.nbd.questions.map((q) => [q, true])),
        nextAction:
          status === 'OPEN' ? ['Site visit', 'Send samples', 'Price discussion', 'Call back'][i % 4] : null,
        nextActionOn:
          status === 'OPEN' ? (i % 5 === 0 ? addDays(today, -2) : addDays(today, 1 + (i % 4))) : null,
        lostReason: status === 'LOST' ? 'Went with a cheaper brand' : null,
        closedAt: status === 'WON' || status === 'LOST' ? at : null,
        createdById: id('Neha Kapoor') ?? rohit,
        createdAt: new Date(at.getTime() - 5 * 86_400_000),
      },
    });
    await db.leadEvent.create({
      data: { companyId, leadId: lead.id, type: 'created', byId: rohit, at: lead.createdAt },
    });
  }
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'lead', fy: '' } },
    create: { companyId, key: 'lead', fy: '', value: L.length },
    update: { value: L.length },
  });
  await generateCalls(db, companyId);
  return true;
}
