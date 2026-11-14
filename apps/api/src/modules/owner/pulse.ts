import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '@mono/db';
import { AppError } from '../../lib/errors';
import { createTask } from '../delegation/service';
import { actorFor, can, type Actor } from '../work/actor';
import { forbidden } from '../../lib/errors';
import { places, spanOf } from './core';

/** The link on the table's QR: the outlet's id signed with the server's secret (nothing is stored for it). */
export function pulseToken(secret: string, outletId: string) {
  const sig = createHmac('sha256', secret).update(`pulse:${outletId}`).digest('base64url').slice(0, 16);
  return `${outletId}.${sig}`;
}
function outletIdOf(secret: string, token: string): string | null {
  const [outletId, sig] = token.split('.');
  if (!outletId || !sig) return null;
  const want = pulseToken(secret, outletId).split('.')[1]!;
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? outletId : null;
}

async function outletFor(db: Db, secret: string, token: string) {
  const id = outletIdOf(secret, token);
  const outlet = id ? await db.outlet.findFirst({ where: { id, deletedAt: null, active: true } }) : null;
  if (!outlet) throw new AppError(404, 'NOT_FOUND', 'This link is not in use');
  return outlet;
}

/** What the guest's page shows: where they are. */
export async function pulsePage(db: Db, secret: string, token: string) {
  const outlet = await outletFor(db, secret, token);
  const company = await db.company.findUniqueOrThrow({
    where: { id: outlet.companyId },
    select: { name: true },
  });
  return { outlet: outlet.name, company: company.name };
}

/**
 * A guest's rating. With a bill number the steward who served is found; one or two stars becomes a task for
 * the branch's manager, due in a day, so somebody answers for it.
 */
export async function ratePulse(
  db: Db,
  secret: string,
  token: string,
  input: { stars: number; comment?: string | null; billNo?: string | null },
) {
  const outlet = await outletFor(db, secret, token);
  const billNo = input.billNo?.trim() || null;
  const check = billNo
    ? await db.posCheck.findFirst({
        where: { companyId: outlet.companyId, outletId: outlet.id, number: billNo },
        select: { orderId: true },
      })
    : null;
  const order = check
    ? await db.posOrder.findFirst({
        where: { id: check.orderId },
        select: { stewardId: true, createdById: true },
      })
    : null;
  const comment = input.comment?.trim().slice(0, 500) || null;
  const row = await db.pulseRating.create({
    data: {
      companyId: outlet.companyId,
      branchId: outlet.branchId,
      outletId: outlet.id,
      stars: input.stars,
      comment,
      billNo,
      stewardId: order?.stewardId ?? order?.createdById ?? null,
    },
  });
  if (input.stars <= 2) {
    const manager = await db.branchManager.findFirst({
      where: { companyId: outlet.companyId, branchId: outlet.branchId, role: 'MANAGER' },
      select: { userId: true },
    });
    const owner = await db.user.findFirst({
      where: { companyId: outlet.companyId, deletedAt: null, status: 'ACTIVE', role: { key: 'OWNER' } },
      select: { id: true },
    });
    const giver = owner ? await actorFor(db, outlet.companyId, owner.id) : null;
    const doerId = manager?.userId ?? owner?.id;
    if (giver && doerId && doerId !== undefined) {
      const task = await db.$transaction((tx) =>
        createTask(tx, giver, {
          doerId,
          plannedAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
          description: `A guest gave ${outlet.name} ${input.stars} star${input.stars === 1 ? '' : 's'}${billNo ? ` (bill ${billNo})` : ''}${comment ? `: “${comment}”` : ''}. Find out what went wrong and write what was done.`,
          requireProof: false,
          source: 'pulse',
          sourceId: row.id,
        }),
      );
      await db.pulseRating.update({ where: { id: row.id }, data: { taskId: task.id } });
    }
  }
  return { ok: true };
}

/** The pulse on the owner's desk: the average and the count by outlet and by steward, and the latest words. */
export async function pulse(db: Db, actor: Actor, secret: string, from?: string, to?: string) {
  if (!can(actor, 'core.admin')) throw forbidden("The owner's desk is for the owner and admins");
  const companyId = actor.companyId;
  const s = await spanOf(db, companyId, from, to);
  // Ratings arrive all day: the span's last day runs to now when it is today or later.
  const [rows, pl, outlets] = await Promise.all([
    db.pulseRating.findMany({
      where: { companyId, createdAt: { gte: s.start } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    }),
    places(db, companyId),
    db.outlet.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const group = (key: (r: (typeof rows)[number]) => string | null) => {
    const m = new Map<string, { n: number; sum: number; low: number }>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      const x = m.get(k) ?? m.set(k, { n: 0, sum: 0, low: 0 }).get(k)!;
      x.n += 1;
      x.sum += r.stars;
      if (r.stars <= 2) x.low += 1;
    }
    return m;
  };
  const avg = (x: { n: number; sum: number }) => Math.round((x.sum / x.n) * 10) / 10;
  const byOutlet = group((r) => r.outletId);
  const bySteward = group((r) => r.stewardId);
  return {
    from: s.from,
    count: rows.length,
    average: rows.length ? avg({ n: rows.length, sum: rows.reduce((n, r) => n + r.stars, 0) }) : null,
    low: rows.filter((r) => r.stars <= 2).length,
    outlets: outlets.map((o) => {
      const x = byOutlet.get(o.id);
      return {
        outletId: o.id,
        outlet: o.name,
        link: `/pulse/${pulseToken(secret, o.id)}`,
        count: x?.n ?? 0,
        average: x ? avg(x) : null,
        low: x?.low ?? 0,
      };
    }),
    stewards: [...bySteward]
      .map(([id, x]) => ({ userId: id, name: pl.name(id), count: x.n, average: avg(x), low: x.low }))
      .sort((a, b) => a.average - b.average),
    latest: rows
      .filter((r) => r.comment)
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        stars: r.stars,
        comment: r.comment,
        outlet: pl.outletName.get(r.outletId) ?? '',
        at: r.createdAt,
      })),
  };
}
