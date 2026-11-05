import { formatNumber, nextCounter, type Db } from '@mono/db';
import { SEGMENTS, splitTable } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, money, need } from './access';
import { customerBook, type BookRow } from './book';

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().max(60).nullish(),
  mobile: z
    .string()
    .trim()
    .regex(/^\+?[0-9 -]{8,16}$/, 'A mobile number')
    .nullish()
    .or(z.literal('')),
  email: z.email().nullish().or(z.literal('')),
  segment: z.enum(SEGMENTS).nullish(),
  handledById: z.string().nullish(),
  creditDays: z.number().int().min(0).max(365).default(30),
  ownerCustomer: z.boolean().default(false),
  fields: z.record(z.string(), z.unknown()).default({}),
});

const names = async (db: Db, ids: (string | null)[]) =>
  new Map(
    (
      await db.user.findMany({
        where: { id: { in: ids.filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );

/** A customer row as the screens show it (money as paise strings). */
export function customerView(r: BookRow, handledBy: string | null) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    city: r.city,
    mobile: r.mobile,
    email: r.email,
    segment: r.segment,
    handledById: r.handledById,
    handledBy,
    creditDays: r.creditDays,
    ownerCustomer: r.ownerCustomer,
    lostReason: r.lostReason,
    fields: r.fields,
    sales12: money(r.sales12),
    gp12: money(r.gp12),
    marginPct: r.sales12 ? Math.round((r.gp12 / r.sales12) * 1000) / 10 : null,
    orders12: r.orders12,
    lastOrder: r.lastOrder,
    receivable: money(r.receivable),
    overdue: money(r.overdue),
    autoTags: r.autoTags,
    tags: r.tags,
    scot: { ...r.scot, averageOrder: money(r.scot.averageOrder) },
  };
}

/** Customer Master (§11.2): every customer with 12 months' sales, GP and rank, tags, and the tiles. */
export async function listCustomers(db: Db, actor: Actor) {
  need(actor, 'crm.view', "You can't see customers");
  const { rows } = await customerBook(db, actor.companyId);
  const who = await names(
    db,
    rows.map((r) => r.handledById),
  );
  const ranked = [...rows].sort((a, b) => b.gp12 - a.gp12);
  const rank = new Map(ranked.filter((r) => r.gp12 > 0).map((r, i) => [r.id, i + 1]));
  const totalGp = rows.reduce((a, r) => a + r.gp12, 0);
  const has = (t: string) => rows.filter((r) => r.autoTags.includes(t as never));
  return {
    customers: rows.map((r) => ({
      ...customerView(r, r.handledById ? (who.get(r.handledById) ?? null) : null),
      gpRank: rank.get(r.id) ?? null,
    })),
    tiles: {
      customers: rows.length,
      top20GpSharePct: totalGp
        ? Math.round((has('top20').reduce((a, r) => a + r.gp12, 0) / totalGp) * 100)
        : 0,
      withOwner: money(has('owners').reduce((a, r) => a + r.sales12, 0)),
      sleeping: has('sleeping').length,
      lost: has('lost').length,
      vampires: has('vampire').length,
    },
  };
}

/** One customer's card: their numbers, what they buy most, and 12 months of orders. */
export async function customerDetail(db: Db, actor: Actor, id: string) {
  need(actor, 'crm.view', "You can't see customers");
  const { rows, today } = await customerBook(db, actor.companyId, { ids: [id] });
  const r = rows[0];
  if (!r) throw notFound('Customer');
  const orders = await db.salesOrder.findMany({
    where: { customerId: id, orderDate: { gte: `${Number(today.slice(0, 4)) - 1}${today.slice(4)}` } },
    orderBy: { orderDate: 'desc' },
    take: 100,
  });
  const who = await names(db, [r.handledById]);
  return {
    ...customerView(r, r.handledById ? (who.get(r.handledById) ?? null) : null),
    ageing: Object.fromEntries(Object.entries(r.ageing).map(([k, v]) => [k, money(v)])),
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      date: o.orderDate,
      amount: money(o.amount),
      gp: money(o.gp),
      status: o.status,
      items: o.items,
    })),
  };
}

async function checkPerson(db: Db, companyId: string, id: string | null | undefined) {
  if (id && !(await db.user.count({ where: { id, companyId, deletedAt: null } })))
    throw new AppError(400, 'VALIDATION_FAILED', 'The person handling this customer is not in the company');
}

export async function saveCustomer(db: Db, actor: Actor, input: z.input<typeof customerSchema>, id?: string) {
  need(actor, id ? 'crm.edit' : 'crm.create', "You can't change customers");
  const c = customerSchema.parse(input);
  await checkPerson(db, actor.companyId, c.handledById);
  const dup = await db.customer.findFirst({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      name: { equals: c.name, mode: 'insensitive' },
      ...(id ? { id: { not: id } } : {}),
    },
  });
  if (dup) throw new AppError(409, 'CONFLICT', `${dup.name} (${dup.code}) is already a customer`);
  const data = { ...c, mobile: c.mobile || null, email: c.email || null, fields: c.fields as object };
  return db.$transaction(async (tx) => {
    const before = id
      ? await tx.customer.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } })
      : null;
    if (id && !before) throw notFound('Customer');
    const row = id
      ? await tx.customer.update({ where: { id }, data })
      : await tx.customer.create({
          data: {
            companyId: actor.companyId,
            code: formatNumber('CUS', await nextCounter(tx, actor.companyId, 'customer')),
            ...data,
          },
        });
    await writeAudit(tx, ctxOf(actor), {
      action: id ? 'crm.customer_changed' : 'crm.customer_added',
      entityType: 'customer',
      entityId: row.id,
      before,
      after: c,
    });
    return { id: row.id, code: row.code, name: row.name };
  });
}

/** Your own tags on a customer (the tag must be defined in Fields & tags). */
export async function setTags(db: Db, actor: Actor, id: string, tags: string[], defined: string[]) {
  need(actor, 'crm.edit', "You can't change customers");
  const bad = tags.filter((t) => !defined.includes(t));
  if (bad.length) throw new AppError(400, 'VALIDATION_FAILED', `Unknown tag: ${bad.join(', ')}`);
  const c = await db.customer.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!c) throw notFound('Customer');
  await db.$transaction(async (tx) => {
    await tx.customerTag.deleteMany({ where: { customerId: id, tag: { notIn: tags } } });
    await tx.customerTag.createMany({
      data: tags.map((tag) => ({ companyId: actor.companyId, customerId: id, tag })),
      skipDuplicates: true,
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'crm.customer_tags',
      entityType: 'customer',
      entityId: id,
      after: { tags },
    });
  });
  return { tags };
}

export const importCustomersSchema = z.object({ text: z.string().max(500_000) });
const HEAD: Record<string, string> = {
  name: 'name',
  customer: 'name',
  city: 'city',
  mobile: 'mobile',
  phone: 'mobile',
  email: 'email',
  segment: 'segment',
  'credit days': 'creditDays',
};

/** Paste or open a list of customers (Name, City, Mobile, Email, Segment, Credit days): all or nothing. */
export async function importCustomers(db: Db, actor: Actor, text: string) {
  need(actor, 'crm.create', "You can't add customers");
  const table = splitTable(text);
  if (!table.length) throw new AppError(400, 'VALIDATION_FAILED', 'Nothing to import');
  const head = table[0]!.map((c) => HEAD[c.trim().toLowerCase()]);
  const hasHead = head.filter(Boolean).length >= 1 && head[0] !== undefined;
  const order = hasHead ? head : ['name', 'city', 'mobile', 'email', 'segment', 'creditDays'];
  const existing = new Set(
    (
      await db.customer.findMany({
        where: { companyId: actor.companyId, deletedAt: null },
        select: { name: true },
      })
    ).map((c) => c.name.toLowerCase()),
  );
  const seen = new Set<string>();
  const problems: { line: number; error: string }[] = [];
  const rows = table.slice(hasHead ? 1 : 0).map((cells, i) => {
    const get = (k: string) => (cells[order.indexOf(k)] ?? '').trim();
    const raw = {
      name: get('name'),
      city: get('city') || null,
      mobile: get('mobile') || null,
      email: get('email') || null,
      segment: (get('segment').toLowerCase() || null) as never,
      creditDays: get('creditDays') ? Number(get('creditDays')) : 30,
    };
    const parsed = customerSchema.safeParse(raw);
    const line = i + (hasHead ? 2 : 1);
    if (!parsed.success) problems.push({ line, error: parsed.error.issues[0]!.message });
    const key = raw.name.toLowerCase();
    if (existing.has(key) || seen.has(key))
      problems.push({ line, error: `${raw.name} is already a customer` });
    seen.add(key);
    return parsed.data;
  });
  if (problems.length)
    throw new AppError(400, 'VALIDATION_FAILED', `${problems.length} line(s) need attention`, {
      lines: problems,
    });
  await db.$transaction(async (tx) => {
    for (const c of rows)
      await tx.customer.create({
        data: {
          companyId: actor.companyId,
          code: formatNumber('CUS', await nextCounter(tx, actor.companyId, 'customer')),
          ...c!,
          mobile: c!.mobile || null,
          email: c!.email || null,
          fields: {},
        },
      });
    await writeAudit(tx, ctxOf(actor), {
      action: 'crm.customers_imported',
      entityType: 'customer',
      entityId: actor.companyId,
      after: { count: rows.length },
    });
  });
  return { created: rows.length };
}
