import type { Db } from '@mono/db';
import { addDays, localDate, weekdayOf, zonedToUtc } from '@mono/shared';

/**
 * Phase 4 demo data for Demo Industries: help slips and tickets in every state (some late or escalated)
 * and a busy EA board for the owner, with this week's schedule. Written straight to the tables
 * (no events), so nobody gets notified. Runs only once per company.
 */
export async function seedDemoEngine(db: Db, companyId: string) {
  if (await db.slip.count({ where: { companyId } })) return false;
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const tz = company.timezone;
  const people = await db.user.findMany({ where: { companyId } });
  const by = (name: string) => people.find((p) => p.name === name)!.id;
  const owner = people.find((p) => p.code === 'EMP-001')!.id;
  const ea = by('Sunita Bansal');
  const today = localDate(new Date(), tz);
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600_000);
  const at = (day: number, hhmm: string) =>
    zonedToUtc(addDays(today, day), Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz);

  await db.moduleSetting.upsert({
    where: { companyId_module: { companyId, module: 'ea' } },
    create: { companyId, module: 'ea', json: { eaUserId: ea }, changedById: owner },
    update: {},
  });
  let taskNo = (await db.task.aggregate({ where: { companyId }, _max: { number: true } }))._max.number ?? 0;

  // ---- Help slips: [raiser, receiver (HOD), problem, solutions, status, hours in this step, extra]
  type SlipSeed = [
    string,
    string,
    string,
    string[],
    string,
    number,
    { chosen?: number; reason?: string; doer?: string }?,
  ];
  const SLIPS: SlipSeed[] = [
    [
      'Sandeep Pal',
      'Ramesh Choudhary',
      'Forklift 2 battery dies before lunch on most days',
      ['Buy a new 48V battery', 'Charge it during the lunch break', 'Swap with forklift 1 battery'],
      'SUBMITTED',
      2,
    ],
    [
      'Gopal Prajapat',
      'Mahesh Yadav',
      'Store has no shelf for returned slabs; they block the aisle',
      ['Put up a 3-tier rack near gate 2', 'Send returns straight to quality', 'Mark a floor zone with tape'],
      'SUBMITTED',
      7,
    ],
    [
      'Deepak Saini',
      'Ajay Meena',
      'Polishing line 1 stops 3–4 times a shift for water pressure',
      ['Add a booster pump', 'Clean the inlet filter daily', 'Run line 1 only in the morning'],
      'RETURNED',
      5,
    ],
    [
      'Harish Joshi',
      'Priya Sharma',
      'Quality samples get mixed up between shifts',
      ['Number every sample bag', 'One shelf per shift', 'Log samples in a register'],
      'WITH_APPROVER',
      3,
    ],
    [
      'Ravi Kumar',
      'Mahesh Yadav',
      'Trucks wait 2 hours for loading every evening',
      ['Book loading slots', 'Start loading at 3 pm', 'Add a second loading crew'],
      'WITH_APPROVER',
      30,
    ],
    [
      'Lalit Jangid',
      'Ramesh Choudhary',
      'Spare bearings are bought in a hurry at high prices',
      ['Keep 5 of each size in stock', 'Yearly rate contract with one vendor', 'Order every Monday'],
      'APPROVED',
      20,
      { chosen: 0, doer: 'Amit Khandelwal' },
    ],
    [
      'Manoj Kumawat',
      'Ajay Meena',
      'Canteen tea arrives cold on the far end of the floor',
      ['A second tea point', 'Thermos flasks per line', 'Tea time 10 min earlier'],
      'REJECTED',
      6,
      { reason: 'Canteen contract is being renewed next month; we will add this to it.' },
    ],
    [
      'Pooja Jain',
      'Suresh Agarwal',
      'Vendor bills reach accounts 10 days late',
      ['Vendors email bills to accounts@', 'Purchase scans bills the same day', 'Weekly bill pickup'],
      'CLOSED',
      60,
      { chosen: 1, doer: 'Amit Khandelwal' },
    ],
  ];
  let n = 0;
  for (const [raiser, receiver, problem, solutions, status, h, x] of SLIPS) {
    n++;
    const created = ago(h + 6);
    const decided = ['APPROVED', 'REJECTED', 'CLOSED'].includes(status);
    const slip = await db.slip.create({
      data: {
        companyId,
        number: n,
        problem,
        raiserId: by(raiser),
        receiverId: by(receiver),
        approverId: owner,
        accountableId: by(raiser),
        status,
        returnCount: status === 'RETURNED' ? 1 : 0,
        stepSince: ago(h),
        decidedAt: decided ? ago(h) : null,
        decidedById: decided ? owner : null,
        decisionNote: x?.reason ?? null,
        closedAt: status === 'CLOSED' ? ago(h - 24) : null,
        createdAt: created,
        solutions: { create: solutions.map((text, position) => ({ companyId, position, text })) },
      },
      include: { solutions: true },
    });
    const log = (type: string, hoursAgo: number, extra: object = {}) =>
      db.slipEvent.create({ data: { companyId, slipId: slip.id, type, createdAt: ago(hoursAgo), ...extra } });
    await log('created', h + 6, { actorId: by(raiser), toStatus: 'SUBMITTED' });
    if (status === 'RETURNED')
      await log('comment', h, {
        actorId: by(receiver),
        note: 'Which shift and how long does each stop take? Add that and send again.',
      });
    if (status !== 'SUBMITTED' && status !== 'RETURNED')
      await log('status', h + 2, {
        actorId: by(receiver),
        fromStatus: 'SUBMITTED',
        toStatus: 'WITH_APPROVER',
      });
    if (x?.chosen !== undefined) {
      const chosen = slip.solutions.find((s) => s.position === x.chosen)!;
      taskNo++;
      const done = status === 'CLOSED';
      const task = await db.task.create({
        data: {
          companyId,
          number: taskNo,
          description: `Help slip #${n}: ${chosen.text}`,
          doerId: by(x.doer!),
          creatorId: owner,
          plannedAt: ago(h - 48),
          originalPlannedAt: ago(h - 48),
          status: done ? 'DONE' : 'OPEN',
          acceptedAt: ago(h - 1),
          doneAt: done ? ago(h - 30) : null,
          source: 'slip',
          sourceId: slip.id,
          createdAt: ago(h),
        },
      });
      await db.taskEvent.create({
        data: {
          companyId,
          taskId: task.id,
          type: 'created',
          actorId: owner,
          toStatus: 'OPEN',
          createdAt: ago(h),
        },
      });
      await db.slip.update({
        where: { id: slip.id },
        data: { chosenSolutionId: chosen.id, taskId: task.id },
      });
    }
    if (decided)
      await log('status', h, {
        actorId: owner,
        fromStatus: 'WITH_APPROVER',
        toStatus: status === 'CLOSED' ? 'APPROVED' : status,
      });
    if (status === 'REJECTED') await log('comment', h, { actorId: owner, note: x?.reason });
    if (status === 'CLOSED')
      await log('status', h - 24, { actorId: by(raiser), fromStatus: 'APPROVED', toStatus: 'CLOSED' });
  }
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'slip', fy: '' } },
    create: { companyId, key: 'slip', fy: '', value: n },
    update: { value: n },
  });

  // ---- Help tickets: [raiser, solver, title, status, raised hours ago, fix in hours (from raise), extra]
  type TicketSeed = [
    string,
    string,
    string,
    string,
    number,
    number,
    { reply?: number; level?: number; resolved?: number; reopen?: number }?,
  ];
  const TICKETS: TicketSeed[] = [
    ['Anita Verma', 'Nikhil Sharma', 'Office printer jams on A3 sheets', 'OPEN', 1, 24],
    [
      'Rohit Mittal',
      'Nikhil Sharma',
      'Sales laptop will not connect to office Wi-Fi',
      'OPEN',
      6,
      24,
      { level: 1 },
    ],
    [
      'Ajay Meena',
      'Ramesh Choudhary',
      'Bridge saw blade wobbles at high speed',
      'IN_PROGRESS',
      20,
      48,
      { reply: 1 },
    ],
    [
      'Priya Sharma',
      'Ramesh Choudhary',
      'Lab oven does not hold 105 °C',
      'IN_PROGRESS',
      60,
      24,
      { reply: 3, level: 2 },
    ],
    [
      'Mahesh Yadav',
      'Vikram Singh',
      'GPS tracker on truck RJ14 GD 4512 is offline',
      'IN_PROGRESS',
      10,
      48,
      { reply: 2 },
    ],
    [
      'Kavita Rathore',
      'Nikhil Sharma',
      'Biometric machine at gate 1 rejects new staff',
      'RESOLVED',
      30,
      24,
      { reply: 1, resolved: 4 },
    ],
    [
      'Suresh Agarwal',
      'Nikhil Sharma',
      'Tally backup failed last night',
      'RESOLVED',
      20,
      8,
      { reply: 1, resolved: 2, reopen: 1 },
    ],
    [
      'Neha Kapoor',
      'Nikhil Sharma',
      'Website enquiry form sends no email',
      'CLOSED',
      120,
      24,
      { reply: 2, resolved: 20 },
    ],
    [
      'Amit Khandelwal',
      'Ramesh Choudhary',
      'Weighbridge display shows 0 sometimes',
      'CLOSED',
      90,
      48,
      { reply: 1, resolved: 30 },
    ],
    ['Vikram Singh', 'Mahesh Yadav', 'Dispatch office AC leaks water', 'CANCELLED', 70, 24],
  ];
  n = 0;
  for (const [raiser, solver, title, status, h, fix, x] of TICKETS) {
    n++;
    const created = ago(h);
    const t = await db.ticket.create({
      data: {
        companyId,
        number: n,
        title,
        raiserId: by(raiser),
        solverId: by(solver),
        status,
        plannedFixAt: new Date(created.getTime() + fix * 3600_000),
        firstReplyAt: x?.reply !== undefined ? ago(h - x.reply) : null,
        resolvedAt: x?.resolved !== undefined ? ago(x.resolved) : null,
        closedAt:
          status === 'CLOSED' ? ago((x?.resolved ?? 1) - 2) : status === 'CANCELLED' ? ago(h - 5) : null,
        closedBy: status === 'CLOSED' ? 'raiser' : null,
        reopenCount: x?.reopen ?? 0,
        escalationLevel: x?.level ?? 0,
        escalatedAt: x?.level ? ago(2) : null,
        createdAt: created,
      },
    });
    const log = (type: string, hoursAgo: number, actor: string | null, extra: object = {}) =>
      db.ticketEvent.create({
        data: {
          companyId,
          ticketId: t.id,
          type,
          actorId: actor ? by(actor) : null,
          createdAt: ago(hoursAgo),
          ...extra,
        },
      });
    await log('created', h, raiser, { toStatus: 'OPEN' });
    if (x?.reply !== undefined)
      await log('reply', h - x.reply, solver, { note: 'Seen it. Will check and fix today.' });
    if (x?.level)
      await log('escalated', 2, null, {
        note: `Level ${x.level}: ${x.reply === undefined ? 'no reply in 4 h' : 'the planned fix time has passed'}`,
      });
    if (x?.reopen)
      await log('comment', x.resolved! + 1, raiser, { note: 'Still failing on the second run.' });
    if (x?.resolved !== undefined) await log('reply', x.resolved, solver, { note: 'Fixed and tested.' });
    if (status === 'CANCELLED')
      await log('comment', h - 5, raiser, { note: 'Contractor fixed it under warranty.' });
  }
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'ticket', fy: '' } },
    create: { companyId, key: 'ticket', fy: '', value: n },
    update: { value: n },
  });

  // ---- EA board for the owner: this week's schedule plus every other stage.
  const monday = addDays(today, 1 - weekdayOf(today));
  type EaSeed = [
    string,
    string,
    {
      day?: number;
      start?: string;
      minutes?: number;
      kind?: string;
      waitingOn?: string;
      telegram?: boolean;
      hoursAgo?: number;
    }?,
  ];
  const ITEMS: EaSeed[] = [
    ['Call Jai Ambe about the transport contract', 'CAPTURED', { telegram: true, hoursAgo: 1 }],
    ['Ask CA about the GST notice for Q2', 'CAPTURED', { hoursAgo: 3 }],
    ['Idea: solar panels on the factory roof', 'CAPTURED', { telegram: true, hoursAgo: 20 }],
    ['New Levanto colour names from marketing', 'INFORMATION', { hoursAgo: 30 }],
    ['Bank changed the RM — Mr. Bhatia, 98290 00000', 'INFORMATION', { hoursAgo: 50 }],
    ['Visit the Morbi tile expo', 'SOMEDAY', { hoursAgo: 80 }],
    ['Second polishing line for Niwai', 'SOMEDAY', { hoursAgo: 120 }],
    ['Review staff uniforms', 'SOMEDAY', { hoursAgo: 150 }],
    ['Quote for the new bridge saw', 'WAITING', { waitingOn: 'Breton India', hoursAgo: 48 }],
    ['Land papers for the Tonk mine extension', 'WAITING', { waitingOn: 'Tehsil office', hoursAgo: 96 }],
    ['Board meeting: Q2 numbers', 'SCHEDULED', { day: 0, start: '11:00', minutes: 90, kind: 'meeting' }],
    ['Call the bank about the CC limit', 'SCHEDULED', { day: 1, start: '10:00', minutes: 30, kind: 'call' }],
    [
      'Review the dispatch backlog with Mahesh',
      'SCHEDULED',
      { day: 2, start: '16:00', minutes: 60, kind: 'review' },
    ],
    ['Meet the Jaipur dealer', 'SCHEDULED', { day: 3, start: '12:00', minutes: 60, kind: 'meeting' }],
    ['Sign the cheques', 'SCHEDULED', { day: 4, start: '09:00', minutes: 30, kind: 'task' }],
    ['Get 3 quotes for the new forklift', 'DELEGATED', { hoursAgo: 60 }],
    ['Send Diwali greetings list to Sunita', 'DONE', { hoursAgo: 26 }],
  ];
  n = 0;
  for (const [text, stage, x] of ITEMS) {
    n++;
    let taskId: string | null = null;
    if (stage === 'DELEGATED') {
      taskNo++;
      const task = await db.task.create({
        data: {
          companyId,
          number: taskNo,
          description: text,
          doerId: by('Amit Khandelwal'),
          creatorId: ea,
          plannedAt: ago(-24),
          originalPlannedAt: ago(-24),
          status: 'OPEN',
          acceptedAt: ago(50),
          source: 'ea',
          createdAt: ago(60),
        },
      });
      taskId = task.id;
    }
    const scheduledDay = x?.day !== undefined ? addDays(monday, x.day) : null;
    const item = await db.eaItem.create({
      data: {
        companyId,
        number: n,
        ownerId: owner,
        createdById: x?.telegram ? owner : ea,
        text,
        stage,
        kind: x?.kind ?? null,
        scheduledDate: scheduledDay,
        slotStart: x?.start ? Number(x.start.slice(0, 2)) * 60 + Number(x.start.slice(3)) : null,
        slotMinutes: x?.minutes ?? null,
        waitingOn: x?.waitingOn ?? null,
        taskId,
        source: x?.telegram ? 'telegram' : 'web',
        stageChangedAt: x?.hoursAgo !== undefined ? ago(x.hoursAgo) : at(-1, '18:00'),
        doneAt: stage === 'DONE' ? ago(x?.hoursAgo ?? 1) : null,
        createdAt: x?.hoursAgo !== undefined ? ago(x.hoursAgo + 2) : at(-2, '10:00'),
      },
    });
    if (taskId) await db.task.update({ where: { id: taskId }, data: { sourceId: item.id } });
  }
  // Scheduled days before today would roll back to Someday on the first sweep; keep them in the future.
  await db.eaItem.updateMany({
    where: { companyId, stage: 'SCHEDULED', scheduledDate: { lt: today } },
    data: { scheduledDate: today },
  });
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'ea', fy: '' } },
    create: { companyId, key: 'ea', fy: '', value: n },
    update: { value: n },
  });
  // Last, after every task this seed created (slip decisions and the delegated EA item).
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'task', fy: '' } },
    create: { companyId, key: 'task', fy: '', value: taskNo },
    update: { value: taskNo },
  });
  return true;
}
