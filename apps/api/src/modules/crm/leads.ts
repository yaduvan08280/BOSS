import { formatNumber, nextCounter, type Db } from '@mono/db';
import { leadMachine, NBD_SEATS, transition, type LeadAction, type LeadStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { crmConfigOf, crmRole, ctxOf, fyCalendar, money, need, seatPeople } from './access';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const enquirySchema = z.object({
  name: z.string().trim().min(2).max(80),
  company: z.string().trim().max(120).nullish(),
  mobile: z
    .string()
    .trim()
    .regex(/^\+?[0-9 -]{8,16}$/, 'A mobile number'),
  email: z.email().nullish().or(z.literal('')),
  city: z.string().trim().min(2).max(60),
  source: z.string().trim().min(1).max(40),
  requirement: z.string().trim().min(2).max(500),
  value: z.number().int().min(0).max(1e15).default(0),
  buyWhen: z.string().trim().max(40).nullish(),
  ownerId: z.string().nullish(),
  fields: z.record(z.string(), z.unknown()).default({}),
});

const DAY = 86_400_000;

/** NBD Funnel (§11.2): enquiries to qualify, leads by stage (days in stage vs plan), and the tiles. */
export async function funnel(db: Db, actor: Actor, ownerId?: string) {
  need(actor, 'crm.view', "You can't see the funnel");
  const config = await crmConfigOf(db, actor.companyId);
  const { today } = await fyCalendar(db, actor.companyId);
  const role = await crmRole(db, actor);
  const owner = role.all ? ownerId : actor.userId;
  const leads = await db.lead.findMany({
    where: {
      companyId: actor.companyId,
      ...(owner ? { ownerId: owner } : {}),
      OR: [{ status: { in: ['ENQUIRY', 'OPEN'] } }, { closedAt: { gte: new Date(Date.now() - 90 * DAY) } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: leads.map((l) => l.ownerId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const plan = new Map(config.nbd.stages.map((s) => [s.key, s.days]));
  const view = (l: (typeof leads)[number]) => {
    const days = Math.floor((Date.now() - l.stageSince.getTime()) / DAY);
    return {
      id: l.id,
      number: formatNumber('L', l.number),
      name: l.name,
      company: l.company,
      mobile: l.mobile,
      email: l.email,
      city: l.city,
      source: l.source,
      requirement: l.requirement,
      value: money(l.value),
      buyWhen: l.buyWhen,
      status: l.status as LeadStatus,
      stage: l.stage,
      daysInStage: days,
      plannedDays: l.stage ? (plan.get(l.stage) ?? null) : null,
      stuck: l.status === 'OPEN' && days > (plan.get(l.stage ?? '') ?? Infinity),
      nextAction: l.nextAction,
      nextActionOn: l.nextActionOn,
      noNext: l.status === 'OPEN' && (!l.nextActionOn || l.nextActionOn < today),
      ownerId: l.ownerId,
      owner: l.ownerId ? (names.get(l.ownerId) ?? null) : null,
      createdAt: l.createdAt,
      fields: l.fields,
    };
  };
  const all = leads.map(view);
  const open = all.filter((l) => l.status === 'OPEN');
  const won = all.filter((l) => l.status === 'WON');
  const lost = all.filter((l) => l.status === 'LOST');
  return {
    stages: config.nbd.stages,
    sources: config.nbd.sources,
    questions: config.nbd.questions,
    fields: config.nbd.fields,
    enquiries: all.filter((l) => l.status === 'ENQUIRY'),
    columns: config.nbd.stages.map((s) => ({ ...s, leads: open.filter((l) => l.stage === s.key) })),
    closed: [...won, ...lost].slice(0, 50),
    tiles: {
      toQualify: all.filter((l) => l.status === 'ENQUIRY').length,
      open: open.length,
      inFunnel: money(open.reduce((a, l) => a + Number(l.value), 0)),
      stuck: open.filter((l) => l.stuck).length,
      noNext: open.filter((l) => l.noNext).length,
      won90: money(won.reduce((a, l) => a + Number(l.value), 0)),
      winRatePct:
        won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    },
    canPickOwner: role.all,
  };
}

async function log(
  tx: Parameters<Parameters<Db['$transaction']>[0]>[0],
  actor: Actor,
  leadId: string,
  type: string,
  x: { fromStage?: string | null; toStage?: string | null; note?: string | null } = {},
) {
  await tx.leadEvent.create({ data: { companyId: actor.companyId, leadId, type, byId: actor.userId, ...x } });
  await writeAudit(tx, ctxOf(actor), {
    action: `crm.lead_${type}`,
    entityType: 'lead',
    entityId: leadId,
    after: x,
  });
}

/** + New enquiry: it waits to be qualified; whoever owns it (or the first NBD SC) hears about it. */
export async function createEnquiry(db: Db, actor: Actor, input: z.input<typeof enquirySchema>) {
  need(actor, 'crm.create', "You can't add enquiries");
  const e = enquirySchema.parse(input);
  const config = await crmConfigOf(db, actor.companyId);
  if (!config.nbd.sources.includes(e.source))
    throw new AppError(400, 'VALIDATION_FAILED', 'Pick a lead source from the list');
  const ownerId =
    e.ownerId ??
    (await Promise.all(NBD_SEATS.map((s) => seatPeople(db, actor.companyId, s, config)))).flat()[0] ??
    actor.userId;
  if (!(await db.user.count({ where: { id: ownerId, companyId: actor.companyId, deletedAt: null } })))
    throw new AppError(400, 'VALIDATION_FAILED', 'The owner is not in the company');
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        companyId: actor.companyId,
        number: await nextCounter(tx, actor.companyId, 'lead'),
        ...e,
        email: e.email || null,
        value: BigInt(e.value),
        ownerId,
        fields: e.fields as object,
        createdById: actor.userId,
      },
    });
    await log(tx, actor, lead.id, 'created');
    await emitEvent(tx, ctxOf(actor), {
      name: 'crm.lead_assigned',
      entityType: 'lead',
      entityId: lead.id,
      payload: {
        userId: ownerId,
        lead: e.company || e.name,
        city: e.city,
        source: e.source,
        next: 'Qualify the enquiry',
        link: '/crm/nbd',
      },
    });
    return { id: lead.id };
  });
}

export const leadActionSchema = z.object({
  action: z.enum(['qualify', 'disqualify', 'move', 'win', 'lose', 'reopen', 'next']),
  /** qualify: the answers (all must be yes) */
  answers: z.record(z.string(), z.boolean()).optional(),
  value: z.number().int().min(0).max(1e15).optional(),
  stage: z.string().optional(),
  nextAction: z.string().trim().min(2).max(200).optional(),
  nextActionOn: date.optional(),
  ownerId: z.string().optional(),
  reason: z.string().trim().min(3).max(300).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Qualify (all questions yes, a value, the next action and its date → the first stage) or not; move a stage; set
 * the next action; win (→ a new customer) or lose (why); reopen.
 */
export async function leadAction(db: Db, actor: Actor, id: string, input: z.input<typeof leadActionSchema>) {
  need(actor, 'crm.create', "You can't change leads");
  const a = leadActionSchema.parse(input);
  const lead = await db.lead.findFirst({ where: { id, companyId: actor.companyId } });
  if (!lead) throw notFound('Lead');
  const role = await crmRole(db, actor);
  if (!role.all && lead.ownerId && lead.ownerId !== actor.userId)
    throw new AppError(403, 'FORBIDDEN', 'This lead is someone else’s');
  const config = await crmConfigOf(db, actor.companyId);
  const { today } = await fyCalendar(db, actor.companyId);
  const stages = config.nbd.stages.map((s) => s.key);
  const needNext = () => {
    if (!a.nextAction || !a.nextActionOn)
      throw new AppError(400, 'VALIDATION_FAILED', 'What is the next action, and when?');
    if (a.nextActionOn < today)
      throw new AppError(400, 'VALIDATION_FAILED', "The next action can't be in the past");
  };
  if (a.action === 'next') {
    if (lead.status !== 'OPEN' && lead.status !== 'ENQUIRY')
      throw new AppError(409, 'CONFLICT', 'This lead is closed');
    needNext();
    if (
      a.ownerId &&
      !(await db.user.count({ where: { id: a.ownerId, companyId: actor.companyId, deletedAt: null } }))
    )
      throw new AppError(400, 'VALIDATION_FAILED', 'The owner is not in the company');
    await db.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: {
          nextAction: a.nextAction,
          nextActionOn: a.nextActionOn,
          ...(a.ownerId ? { ownerId: a.ownerId } : {}),
        },
      });
      await log(tx, actor, id, 'note', {
        note: `Next: ${a.nextAction} (${a.nextActionOn})${a.note ? ` · ${a.note}` : ''}`,
      });
    });
    return { status: lead.status };
  }
  const to = transition(leadMachine, {
    from: lead.status as LeadStatus,
    action: a.action as LeadAction,
    roles: ['sales'],
    ctx: {},
  }).to;
  const data: Record<string, unknown> = { status: to };
  if (a.action === 'qualify') {
    const missing = config.nbd.questions.filter((q) => a.answers?.[q] !== true);
    if (missing.length) throw new AppError(400, 'VALIDATION_FAILED', `Not a lead yet: ${missing.join(' ')}`);
    needNext();
    Object.assign(data, {
      stage: stages[0],
      stageSince: new Date(),
      qualify: a.answers,
      value: BigInt(a.value ?? Number(lead.value)),
      nextAction: a.nextAction,
      nextActionOn: a.nextActionOn,
    });
  }
  if (a.action === 'move') {
    if (!a.stage || !stages.includes(a.stage))
      throw new AppError(400, 'VALIDATION_FAILED', 'Pick a stage from the funnel');
    if (a.stage === lead.stage) throw new AppError(409, 'CONFLICT', 'The lead is already in that stage');
    needNext();
    Object.assign(data, {
      stage: a.stage,
      stageSince: new Date(),
      nextAction: a.nextAction,
      nextActionOn: a.nextActionOn,
    });
  }
  if (a.action === 'lose' || a.action === 'disqualify') {
    if (!a.reason) throw new AppError(400, 'VALIDATION_FAILED', 'Why?');
    Object.assign(data, { lostReason: a.reason, closedAt: new Date() });
  }
  if (a.action === 'reopen')
    Object.assign(data, { stage: null, lostReason: null, closedAt: null, stageSince: new Date() });
  return db.$transaction(async (tx) => {
    if (a.action === 'win') {
      // The lead becomes a customer (or joins one with the same name).
      const name = lead.company?.trim() || lead.name;
      const existing = await tx.customer.findFirst({
        where: { companyId: actor.companyId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
      });
      const customer =
        existing ??
        (await tx.customer.create({
          data: {
            companyId: actor.companyId,
            code: formatNumber('CUS', await nextCounter(tx, actor.companyId, 'customer')),
            name,
            city: lead.city,
            mobile: lead.mobile,
            email: lead.email,
            handledById: lead.ownerId,
            fields: {},
          },
        }));
      Object.assign(data, { customerId: customer.id, closedAt: new Date() });
    }
    await tx.lead.update({ where: { id }, data });
    await log(
      tx,
      actor,
      id,
      a.action === 'move'
        ? 'moved'
        : a.action === 'qualify'
          ? 'qualified'
          : a.action === 'win'
            ? 'won'
            : a.action === 'lose'
              ? 'lost'
              : a.action === 'reopen'
                ? 'reopened'
                : 'disqualified',
      {
        fromStage: lead.stage,
        toStage: (data.stage as string | undefined) ?? lead.stage,
        note: a.reason ?? a.note ?? null,
      },
    );
    return { status: to, customerId: (data.customerId as string | undefined) ?? null };
  });
}

/** Leads past their stage's planned days tell their owner, once per stage. */
export async function leadsStuck(db: Db, companyId: string, claim: (key: string) => Promise<boolean>) {
  const config = await crmConfigOf(db, companyId);
  const plan = new Map(config.nbd.stages.map((s) => [s.key, s]));
  const open = await db.lead.findMany({ where: { companyId, status: 'OPEN' } });
  let n = 0;
  for (const l of open) {
    const s = plan.get(l.stage ?? '');
    const days = Math.floor((Date.now() - l.stageSince.getTime()) / DAY);
    if (
      !s ||
      days <= s.days ||
      !l.ownerId ||
      !(await claim(`crm.stuck:${l.id}:${l.stageSince.toISOString()}`))
    )
      continue;
    await db.$transaction((tx) =>
      emitEvent(
        tx,
        { companyId, actorId: null },
        {
          name: 'crm.lead_stuck',
          entityType: 'lead',
          entityId: l.id,
          payload: { userId: l.ownerId, lead: l.company || l.name, stage: s.name, days, link: '/crm/nbd' },
        },
      ),
    );
    n++;
  }
  return n;
}
