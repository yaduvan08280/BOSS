import { formatNumber, nextCounter, type Db, type Tx } from '@mono/db';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { can, type Actor } from '../work/actor';

/**
 * Parties (phase 12M): one master for everyone MONO deals with. A party can be several kinds at once (a dealer
 * who also supplies; a guest whose company pays). A CRM customer is a party with the same id, so everything that
 * knew the customer keeps working and its bills, statement and ageing hang on the same row.
 */
export const PARTY_KINDS = [
  'customer',
  'dealer',
  'vendor',
  'guest',
  'company',
  'agent',
  'franchise',
  'transporter',
  // Phase 21: a shop's member — a price list may be for members only.
  'member',
] as const;
export const partySchema = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(160),
  kinds: z.array(z.enum(PARTY_KINDS)).min(1, 'Choose what they are').max(8),
  mobile: z.string().trim().max(20).nullish(),
  email: z.string().trim().max(160).nullish(),
  taxId: z.string().trim().max(40).nullish(),
  state: z.string().trim().max(80).nullish(),
  address: z.string().trim().max(400).nullish(),
  creditDays: z.number().int().min(0).max(365).default(0),
  note: z.string().trim().max(500).nullish(),
});
export type PartyInput = z.infer<typeof partySchema>;

const ctxOf = (a: Actor) => ({ companyId: a.companyId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });
export const norm = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const needEdit = (a: Actor) => {
  if (!can(a, 'money.edit')) throw new AppError(403, 'FORBIDDEN', "You can't change parties");
};

export async function listParties(db: Db, actor: Actor, q: { q?: string; kind?: string }) {
  const rows = await db.party.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      ...(q.kind ? { kinds: { has: q.kind } } : {}),
      ...(q.q?.trim()
        ? {
            OR: [
              { name: { contains: q.q.trim(), mode: 'insensitive' as const } },
              { code: { contains: q.q.trim(), mode: 'insensitive' as const } },
              { mobile: { contains: q.q.trim() } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: 500,
  });
  return rows;
}

export async function saveParty(db: Db, actor: Actor, input: PartyInput, id?: string) {
  needEdit(actor);
  return db.$transaction(async (tx) => {
    const before = id
      ? await tx.party.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } })
      : null;
    if (id && !before) throw notFound('Party');
    const data = {
      name: input.name,
      kinds: [...new Set(input.kinds)],
      mobile: input.mobile || null,
      email: input.email || null,
      taxId: input.taxId || null,
      state: input.state || null,
      address: input.address || null,
      creditDays: input.creditDays,
      note: input.note || null,
    };
    const row = before
      ? await tx.party.update({ where: { id: before.id }, data })
      : await tx.party.create({
          data: {
            ...data,
            companyId: actor.companyId,
            code: formatNumber('PTY', await nextCounter(tx, actor.companyId, 'party')),
            createdById: actor.userId,
          },
        });
    await recordChange(tx, ctxOf(actor), {
      event: before ? 'party.updated' : 'party.created',
      entityType: 'party',
      entityId: row.id,
      before: before ?? undefined,
      after: row,
    });
    return row;
  });
}

/** Deleting is soft, and only for a party no paper names. */
export async function deleteParty(db: Db, actor: Actor, id: string) {
  needEdit(actor);
  const row = await db.party.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!row) throw notFound('Party');
  if (await db.bill.count({ where: { companyId: actor.companyId, partyId: id } }))
    throw new AppError(409, 'CONFLICT', `${row.name} has papers; it can't be deleted`);
  await db.$transaction(async (tx) => {
    await tx.party.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.partyAlias.deleteMany({ where: { companyId: actor.companyId, partyId: id } });
    await recordChange(tx, ctxOf(actor), {
      event: 'party.deleted',
      entityType: 'party',
      entityId: id,
      before: row,
    });
  });
  return { ok: true };
}

/** A CRM customer is a party with the same id (kept in step whenever the customer is made or renamed). */
export async function partyOfCustomer(
  tx: Tx,
  c: {
    id: string;
    companyId: string;
    code: string;
    name: string;
    mobile: string | null;
    email: string | null;
    creditDays: number;
  },
) {
  const data = { name: c.name, mobile: c.mobile, email: c.email, creditDays: c.creditDays };
  const have = await tx.party.findUnique({ where: { id: c.id } });
  if (have) {
    await tx.party.update({
      where: { id: c.id },
      data: { ...data, kinds: [...new Set([...have.kinds, 'customer'])], deletedAt: null },
    });
    return;
  }
  // The customer's code, unless a party already took it (then the party gets its own).
  const taken = await tx.party.count({ where: { companyId: c.companyId, code: c.code } });
  await tx.party.create({
    data: {
      ...data,
      id: c.id,
      companyId: c.companyId,
      code: taken ? formatNumber('PTY', await nextCounter(tx, c.companyId, 'party')) : c.code,
      kinds: ['customer'],
    },
  });
}

/**
 * Vendor names people typed on items and purchase orders, each with how often it is used, the party a person
 * already said it is, and — when the same name exists as a party — a suggestion. Nothing is matched by itself.
 */
export async function typedVendors(db: Db, actor: Actor) {
  const [items, orders, aliases, parties] = await Promise.all([
    db.item.groupBy({
      by: ['vendor'],
      where: { companyId: actor.companyId, deletedAt: null, vendor: { not: null } },
      _count: true,
    }),
    db.purchaseOrder.groupBy({ by: ['vendor'], where: { companyId: actor.companyId }, _count: true }),
    db.partyAlias.findMany({ where: { companyId: actor.companyId } }),
    db.party.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      select: { id: true, name: true, kinds: true },
    }),
  ]);
  const byNorm = new Map<string, { name: string; items: number; orders: number }>();
  const add = (name: string | null, key: 'items' | 'orders', n: number) => {
    if (!name?.trim()) return;
    const k = norm(name);
    const row = byNorm.get(k) ?? { name: name.trim(), items: 0, orders: 0 };
    row[key] += n;
    byNorm.set(k, row);
  };
  for (const i of items) add(i.vendor, 'items', i._count);
  for (const o of orders) add(o.vendor, 'orders', o._count);
  const alias = new Map(aliases.map((a) => [a.norm, a.partyId]));
  const sameName = new Map(parties.map((p) => [norm(p.name), p]));
  return [...byNorm.entries()]
    .map(([k, v]) => ({
      ...v,
      partyId: alias.get(k) ?? null,
      suggestion: alias.has(k) ? null : (sameName.get(k) ?? null),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A person says which party a typed vendor name is — an existing one, or a new vendor made from the name. */
export async function matchVendor(db: Db, actor: Actor, input: { name: string; partyId?: string | null }) {
  needEdit(actor);
  const typed = input.name.trim();
  if (!typed) throw new AppError(400, 'VALIDATION_FAILED', 'Name the vendor');
  return db.$transaction(async (tx) => {
    let party = input.partyId
      ? await tx.party.findFirst({
          where: { id: input.partyId, companyId: actor.companyId, deletedAt: null },
        })
      : null;
    if (input.partyId && !party) throw notFound('Party');
    if (party && !party.kinds.includes('vendor'))
      party = await tx.party.update({ where: { id: party.id }, data: { kinds: [...party.kinds, 'vendor'] } });
    if (!party)
      party = await tx.party.create({
        data: {
          companyId: actor.companyId,
          code: formatNumber('PTY', await nextCounter(tx, actor.companyId, 'party')),
          name: typed,
          kinds: ['vendor'],
          createdById: actor.userId,
        },
      });
    await tx.partyAlias.upsert({
      where: { companyId_norm: { companyId: actor.companyId, norm: norm(typed) } },
      create: { companyId: actor.companyId, norm: norm(typed), partyId: party.id },
      update: { partyId: party.id },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'party.vendor_matched',
      entityType: 'party',
      entityId: party.id,
      after: { typed, partyId: party.id },
    });
    return { partyId: party.id, name: party.name };
  });
}

/** The party a typed vendor name was matched to (null until a person has said). */
export async function vendorParty(db: Db | Tx, companyId: string, typed: string | null | undefined) {
  if (!typed?.trim()) return null;
  const a = await db.partyAlias.findUnique({ where: { companyId_norm: { companyId, norm: norm(typed) } } });
  return a?.partyId ?? null;
}
