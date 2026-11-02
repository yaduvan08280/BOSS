import type { Db } from '@mono/db';
import { addDays, localDate, zonedToUtc } from '@mono/shared';

/**
 * Demo work for Demo Industries (CLAUDE.md §15): ~30 tasks in every state over the last three weeks,
 * 6 checklist masters with a week of history, and a few holidays. Written straight to the tables
 * (no events), so seeding doesn't flood anyone with notifications. Runs only once per company.
 */
export async function seedDemoWork(db: Db, companyId: string) {
  if (await db.task.count({ where: { companyId } })) return false;
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const tz = company.timezone;
  const people = await db.user.findMany({ where: { companyId }, include: { mainDepartment: true } });
  const by = (name: string) => people.find((p) => p.name === name)!.id;
  const owner = people.find((p) => p.code === 'EMP-001')!.id;
  const today = localDate(new Date(), tz);
  const at = (dayOffset: number, hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return zonedToUtc(addDays(today, dayOffset), h! * 60 + m!, tz);
  };
  const hours = (d: Date, h: number) => new Date(d.getTime() + h * 3600_000);

  type Seed = [
    doer: string,
    desc: string,
    day: number,
    time: string,
    status: string,
    opts?: {
      verifier?: string;
      doneH?: number;
      verifyH?: number;
      revisions?: number;
      proof?: boolean;
      creator?: string;
    },
  ];
  const TASKS: Seed[] = [
    [
      'Sandeep Pal',
      'Calibrate press 2 pressure gauges',
      -16,
      '17:00',
      'DONE',
      { verifier: 'Ramesh Choudhary', doneH: -2, verifyH: 0.5 },
    ],
    [
      'Deepak Saini',
      'Replace polishing pads on line 1',
      -15,
      '12:00',
      'DONE',
      { verifier: 'Ajay Meena', doneH: 3, verifyH: 1 },
    ],
    [
      'Gopal Prajapat',
      'Count resin drums in the back store',
      -14,
      '18:00',
      'DONE',
      { verifier: 'Amit Khandelwal', doneH: 30, verifyH: 2, revisions: 1 },
    ],
    ['Sunita Bansal', 'Send Levanto price list to Ram Traders', -13, '11:00', 'DONE', { doneH: -1 }],
    [
      'Mahesh Yadav',
      'Book truck for Jaipur dispatch',
      -12,
      '10:00',
      'DONE',
      { verifier: 'Vikram Singh', doneH: 50, verifyH: 3, revisions: 2 },
    ],
    [
      'Pooja Jain',
      'Reconcile October GST input credit',
      -11,
      '18:00',
      'DONE',
      { verifier: 'Suresh Agarwal', doneH: -5, verifyH: 20 },
    ],
    [
      'Lalit Jangid',
      'Fix leaking hydraulic hose on press 1',
      -10,
      '15:00',
      'DONE',
      { verifier: 'Ramesh Choudhary', doneH: -1, verifyH: 0.5, proof: true },
    ],
    ['Arjun Rawat', 'Visit Kishangarh dealer for sample feedback', -9, '17:00', 'DONE', { doneH: 26 }],
    [
      'Harish Joshi',
      'Thickness test on batch A25D0102',
      -8,
      '13:00',
      'DONE',
      { verifier: 'Priya Sharma', doneH: -0.5, verifyH: 0.7 },
    ],
    [
      'Ravi Kumar',
      'Collect POD for invoice 1045',
      -7,
      '17:00',
      'DONE',
      { verifier: 'Mahesh Yadav', doneH: 5, verifyH: 1 },
    ],
    ['Kavita Rathore', 'Update leave policy notice board', -6, '12:00', 'DONE', { doneH: -3 }],
    [
      'Nikhil Sharma',
      'Set up Telegram on all supervisor phones',
      -5,
      '18:00',
      'DONE',
      { verifier: 'Meena Goyal', doneH: -10, verifyH: 4 },
    ],
    [
      'Manoj Kumawat',
      'Clean mixer blades after shift',
      -4,
      '19:00',
      'PENDING_VERIFY',
      { verifier: 'Ajay Meena', doneH: -1 },
    ],
    [
      'Sandeep Pal',
      'Check compressor oil level',
      -3,
      '10:00',
      'PENDING_VERIFY',
      { verifier: 'Ramesh Choudhary', doneH: 4 },
    ],
    [
      'Amit Khandelwal',
      'Get 3 quotes for quartz grit',
      -3,
      '17:00',
      'PENDING_VERIFY',
      { verifier: 'Meena Goyal', doneH: -2 },
    ],
    [
      'Gopal Prajapat',
      'Label new rack in finished goods store',
      -2,
      '16:00',
      'OPEN',
      { verifier: 'Amit Khandelwal' },
    ],
    [
      'Deepak Saini',
      'Record oven temperature log',
      -2,
      '18:00',
      'OPEN',
      { verifier: 'Ajay Meena', revisions: 1 },
    ],
    ['Arjun Rawat', 'Follow up Sharma Builders quotation', -1, '12:00', 'OPEN', {}],
    [
      'Lalit Jangid',
      'Grease conveyor bearings',
      0,
      '17:00',
      'OPEN',
      { verifier: 'Ramesh Choudhary', proof: true },
    ],
    ['Sunita Bansal', 'Prepare owner’s weekly sales summary', 0, '19:00', 'OPEN', { creator: 'Meena Goyal' }],
    [
      'Harish Joshi',
      'Polishing check on 20 slabs of batch 0104',
      1,
      '13:00',
      'OPEN',
      { verifier: 'Priya Sharma' },
    ],
    ['Pooja Jain', 'File TDS return draft', 2, '18:00', 'OPEN', { verifier: 'Suresh Agarwal' }],
    [
      'Ravi Kumar',
      'Arrange e-way bills for Friday loads',
      1,
      '11:00',
      'AWAITING_ACCEPTANCE',
      { verifier: 'Mahesh Yadav' },
    ],
    ['Manoj Kumawat', 'Shift rotation chart for next week', 2, '17:00', 'AWAITING_ACCEPTANCE', {}],
    [
      'Sanjay Tak',
      'Physical count of packing material',
      3,
      '17:00',
      'AWAITING_ACCEPTANCE',
      { verifier: 'Gopal Prajapat' },
    ],
    ['Neha Kapoor', 'Brochure print order for exhibition', 4, '18:00', 'AWAITING_ACCEPTANCE', {}],
    ['Vikram Singh', 'Renew transport contract with Jai Ambe', -1, '17:00', 'RETURNED_TO_CREATOR', {}],
    ['Anita Verma', 'Order new chairs for meeting room', -6, '12:00', 'CANCELLED', {}],
    ['Rohit Mittal', 'Call back 5 enquiries from IndiaMART', -4, '18:00', 'DONE', { doneH: -2 }],
    [
      'Priya Sharma',
      'Update QC checklist for new colour',
      -9,
      '17:00',
      'DONE',
      { verifier: 'Ajay Meena', doneH: 2, verifyH: 6 },
    ],
  ];

  let n = 0;
  for (const [doer, description, day, time, status, o = {}] of TASKS) {
    n++;
    const planned = at(day, time);
    const doneAt = o.doneH !== undefined ? hours(planned, o.doneH) : null;
    const creator = o.creator ? by(o.creator) : owner;
    const task = await db.task.create({
      data: {
        companyId,
        number: n,
        description,
        doerId: by(doer),
        creatorId: creator,
        verifierId: o.verifier ? by(o.verifier) : null,
        plannedAt: planned,
        originalPlannedAt: o.revisions ? hours(planned, -24 * o.revisions) : planned,
        status,
        requireProof: Boolean(o.proof),
        revisionCount: o.revisions ?? 0,
        source: 'web',
        acceptedAt:
          status === 'AWAITING_ACCEPTANCE' || status === 'RETURNED_TO_CREATOR' ? null : hours(planned, -40),
        doneAt,
        doneNote: doneAt ? 'Done' : null,
        verifiedAt: status === 'DONE' && doneAt && o.verifyH !== undefined ? hours(doneAt, o.verifyH) : null,
        cancelledAt: status === 'CANCELLED' ? hours(planned, -24) : null,
        createdAt: hours(planned, -48),
      },
    });
    await db.taskEvent.create({
      data: {
        companyId,
        taskId: task.id,
        actorId: creator,
        type: 'created',
        toStatus: status,
        createdAt: task.createdAt,
      },
    });
  }
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'task', fy: '' } },
    create: { companyId, key: 'task', fy: '', value: n },
    update: { value: n },
  });

  // Holidays in the coming months (the HR calendar screens arrive in phase 7).
  for (const [date, name, type] of [
    ['2026-11-08', 'Diwali', 'FESTIVAL'],
    ['2026-11-09', 'Govardhan Puja', 'FESTIVAL'],
    ['2026-12-25', 'Christmas', 'OPTIONAL'],
    ['2027-01-26', 'Republic Day', 'NATIONAL'],
  ] as const) {
    await db.holiday.create({ data: { companyId, date, name, type } });
  }

  const dept = (name: string) =>
    people.find((p) => p.mainDepartment?.name === name)?.mainDepartmentId ?? null;
  const MASTERS = [
    {
      name: 'Morning safety round',
      dept: 'Production',
      freq: { type: 'daily' },
      due: 9 * 60 + 30,
      doers: ['Deepak Saini', 'Manoj Kumawat'],
      verifier: 'Ajay Meena',
      items: [
        ['Guards fitted on all machines', 'photo'],
        ['Fire exits clear', ''],
        ['First-aid box stocked', ''],
      ],
    },
    {
      name: 'Store closing check',
      dept: 'Store',
      freq: { type: 'weekdays', weekdays: [1, 2, 3, 4, 5, 6] },
      due: 17 * 60,
      doers: ['Gopal Prajapat'],
      verifier: 'Amit Khandelwal',
      items: [
        ['Cement bags count', 'value'],
        ['Resin drums count', 'value'],
        ['Store locked', 'photo'],
      ],
    },
    {
      name: 'Machine oiling',
      dept: 'Maintenance',
      freq: { type: 'weekly', weekday: 1 },
      due: 10 * 60,
      doers: ['Sandeep Pal'],
      verifier: 'Ramesh Choudhary',
      items: [
        ['Press 1 oiled', ''],
        ['Press 2 oiled', ''],
        ['Conveyor bearings greased', 'photo'],
      ],
    },
    {
      name: 'Fire extinguisher check',
      dept: 'Admin',
      freq: { type: 'monthly', day: 1 },
      due: 11 * 60,
      doers: ['Anita Verma'],
      verifier: null,
      items: [
        ['Pressure in green zone', 'photo'],
        ['Expiry date checked', 'value'],
      ],
    },
    {
      name: 'Gauge calibration',
      dept: 'Quality',
      freq: { type: 'quarterly', day: 5 },
      due: 12 * 60,
      doers: ['Harish Joshi'],
      verifier: 'Priya Sharma',
      items: [
        ['Thickness gauge calibrated', 'photo'],
        ['Certificate filed', ''],
      ],
    },
    {
      name: 'Dispatch day closing',
      dept: 'Dispatch',
      freq: { type: 'daily' },
      due: 19 * 60,
      doers: ['Ravi Kumar'],
      verifier: 'Mahesh Yadav',
      items: [
        ['All PODs collected', ''],
        ['Tomorrow’s trucks confirmed', ''],
        ['Pending orders note', 'voice'],
      ],
    },
  ];
  let code = 0;
  for (const m of MASTERS) {
    code++;
    const items = m.items.map(([text, need], i) => ({
      key: `i${i}`,
      text: text!,
      requirePhoto: need === 'photo',
      requireVoice: need === 'voice',
      requireValue: need === 'value',
    }));
    const master = await db.checklistMaster.create({
      data: {
        companyId,
        code: `CHK-${String(code).padStart(3, '0')}`,
        name: m.name,
        departmentId: dept(m.dept),
        items,
        frequency: m.freq,
        dueMin: m.due,
        windowHours: 4,
        doerIds: m.doers.map(by),
        verifierId: m.verifier ? by(m.verifier) : null,
        skipHolidays: true,
        startDate: addDays(today, -30),
        createdById: owner,
      },
    });
    // A week of history for the daily ones: mostly done, a few missed or waiting for the verifier.
    if (m.freq.type !== 'daily') continue;
    for (let d = -7; d <= -1; d++) {
      for (const doer of m.doers) {
        const planned = zonedToUtc(addDays(today, d), m.due, tz);
        const roll = (d * 7 + doer.length) % 5;
        const status = roll === 0 ? 'MISSED' : roll === 1 && d === -1 ? 'PENDING_VERIFY' : 'DONE';
        await db.checklistRun.create({
          data: {
            companyId,
            masterId: master.id,
            doerId: by(doer),
            verifierId: master.verifierId,
            plannedAt: planned,
            windowEndsAt: hours(planned, 4),
            status,
            itemsTotal: items.length,
            itemsDone: status === 'MISSED' ? 1 : items.length,
            submittedAt: status === 'MISSED' ? null : hours(planned, 0.5),
            verifiedAt: status === 'DONE' ? hours(planned, 1) : null,
            remindedAt: hours(planned, -0.5),
            items: {
              create: items.map((it, i) => ({
                companyId,
                itemKey: it.key,
                text: it.text,
                sortOrder: i,
                requirePhoto: it.requirePhoto,
                requireVoice: it.requireVoice,
                requireValue: it.requireValue,
                done: status !== 'MISSED' || i === 0,
                value: it.requireValue ? '40' : null,
              })),
            },
          },
        });
      }
    }
  }
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'checklist', fy: '' } },
    create: { companyId, key: 'checklist', fy: '', value: code },
    update: { value: code },
  });
  return true;
}
