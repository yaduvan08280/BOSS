import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AgentToken, Db } from '@mono/db';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { agentDone, agentJobs } from '../hosp/print';
import { tallyXml } from '../money/tally';
import { can, type Actor } from '../work/actor';

/**
 * Phase 19 — the site agent: a small program at a branch that prints on the branch's own printers and posts
 * vouchers to its Tally. It signs in with a key of its own (`agt_<prefix>_<secret>`, shown once, only its sha256
 * kept) that can do nothing else: read its branch's print jobs and the vouchers waiting for Tally, and say what
 * became of each.
 */
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const admin = (actor: Actor) => {
  if (!can(actor, 'integrations.admin')) throw new AppError(403, 'FORBIDDEN', "You can't manage site agents");
};
const view = (t: AgentToken) => ({
  id: t.id,
  name: t.name,
  branchId: t.branchId,
  prefix: t.prefix,
  lastSeenAt: t.lastSeenAt,
  revokedAt: t.revokedAt,
  createdAt: t.createdAt,
});

export const agentSchema = z.object({
  branchId: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
});
export async function createAgent(db: Db, actor: Actor, input: z.input<typeof agentSchema>) {
  admin(actor);
  const a = agentSchema.parse(input);
  if (!(await db.branch.count({ where: { id: a.branchId, companyId: actor.companyId, deletedAt: null } })))
    throw notFound('Branch');
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const row = await db.$transaction(async (tx) => {
    const t = await tx.agentToken.create({
      data: {
        companyId: actor.companyId,
        branchId: a.branchId,
        name: a.name,
        prefix,
        hash: sha(secret),
        createdById: actor.userId,
      },
    });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'agent.created',
        entityType: 'agent_token',
        entityId: t.id,
        after: { name: a.name, branchId: a.branchId },
      },
    );
    return t;
  });
  // Shown once: only the hash is kept.
  return { ...view(row), key: `agt_${prefix}_${secret}` };
}
export async function listAgents(db: Db, actor: Actor) {
  admin(actor);
  const rows = await db.agentToken.findMany({
    where: { companyId: actor.companyId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(view);
}
export async function revokeAgent(db: Db, actor: Actor, id: string) {
  admin(actor);
  const t = await db.agentToken.findFirst({ where: { id, companyId: actor.companyId } });
  if (!t) throw notFound('Agent');
  if (!t.revokedAt)
    await db.$transaction(async (tx) => {
      await tx.agentToken.update({ where: { id }, data: { revokedAt: new Date() } });
      await writeAudit(
        tx,
        { companyId: actor.companyId, actorId: actor.userId },
        {
          action: 'agent.revoked',
          entityType: 'agent_token',
          entityId: id,
        },
      );
    });
  return { ok: true };
}

/** Who is calling: the agent of a key (its "last seen" moves on), or nobody. */
export async function agentOf(db: Db, header: string | undefined) {
  const m = /^Bearer agt_([0-9a-f]{12})_([A-Za-z0-9_-]{20,})$/.exec(header ?? '');
  const t = m ? await db.agentToken.findUnique({ where: { prefix: m[1]! } }) : null;
  const given = Buffer.from(sha(m?.[2] ?? ''));
  if (!t || t.revokedAt || !timingSafeEqual(given, Buffer.from(t.hash)))
    throw new AppError(401, 'UNAUTHENTICATED', 'This agent key is not valid');
  await db.agentToken.update({ where: { id: t.id }, data: { lastSeenAt: new Date() } });
  return t;
}
// The agent acts with these two rights and nothing else, at its own branch.
const actorOf = (t: AgentToken): Actor => ({
  companyId: t.companyId,
  userId: t.createdById ?? '',
  permissions: ['hosp.view'],
});

export const agentPrintJobs = (db: Db, t: AgentToken) => agentJobs(db, actorOf(t), t.branchId);
export const agentPrinted = (db: Db, t: AgentToken, id: string, ok: boolean, error?: string | null) =>
  agentJobs(db, actorOf(t), t.branchId).then((jobs) => {
    // Only a job of this branch's printers.
    if (!jobs.some((j) => j.id === id)) throw notFound('Print job');
    return agentDone(db, actorOf(t), id, ok, error);
  });

/** The entity whose books this agent's Tally keeps: its branch's legal entity (none = the company's own). */
async function entityOf(db: Db, t: AgentToken) {
  const b = await db.branch.findFirst({ where: { id: t.branchId }, select: { entityId: true } });
  return b?.entityId ?? null;
}
/**
 * Vouchers waiting for Tally, oldest first, each as its own import (so one refusal does not hold the others).
 * A voucher whose head has no ledger yet is left waiting and named.
 */
export async function agentVouchers(db: Db, t: AgentToken, take = 25) {
  const entityId = await entityOf(db, t);
  const rows = await db.voucher.findMany({
    where: { companyId: t.companyId, entityId, tallyState: null },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    take,
  });
  const vouchers: { id: string; xml: string }[] = [];
  const unmapped = new Set<string>();
  for (const v of rows) {
    const one = await tallyXml(db, t.companyId, [v]);
    if (one.unmapped.length) one.unmapped.forEach((h) => unmapped.add(h));
    else vouchers.push({ id: v.id, xml: one.xml });
  }
  return { vouchers, unmapped: [...unmapped].sort() };
}
export const ackSchema = z.object({
  results: z
    .array(z.object({ id: z.string().max(40), ok: z.boolean(), error: z.string().max(500).nullish() }))
    .max(200),
});
/** What Tally said about each voucher. A failed one is kept with its reason until someone sends it again. */
export async function agentVouchersDone(db: Db, t: AgentToken, input: z.input<typeof ackSchema>) {
  const { results } = ackSchema.parse(input);
  const entityId = await entityOf(db, t);
  let posted = 0;
  for (const r of results) {
    const done = await db.voucher.updateMany({
      where: { id: r.id, companyId: t.companyId, entityId, tallyState: null },
      data: r.ok
        ? { tallyState: 'POSTED', tallyAt: new Date(), tallyError: null }
        : {
            tallyState: 'FAILED',
            tallyAt: new Date(),
            tallyError: (r.error ?? 'Tally refused it').slice(0, 300),
          },
    });
    if (r.ok) posted += done.count;
  }
  return { posted };
}

/** Where Tally posting stands (accounts admin), and a way to send the failed ones again. */
export async function tallyQueue(db: Db, actor: Actor) {
  if (!can(actor, 'money.admin')) throw new AppError(403, 'FORBIDDEN', 'Only the accounts admin sees this');
  const where = { companyId: actor.companyId };
  const [waiting, posted, failed] = await Promise.all([
    db.voucher.count({ where: { ...where, tallyState: null } }),
    db.voucher.count({ where: { ...where, tallyState: 'POSTED' } }),
    db.voucher.findMany({
      where: { ...where, tallyState: 'FAILED' },
      orderBy: { tallyAt: 'desc' },
      take: 50,
    }),
  ]);
  return {
    waiting,
    posted,
    failed: failed.map((v) => ({
      id: v.id,
      date: v.date,
      narration: v.narration,
      error: v.tallyError,
      at: v.tallyAt,
    })),
  };
}
export async function tallyRetry(db: Db, actor: Actor) {
  if (!can(actor, 'money.admin')) throw new AppError(403, 'FORBIDDEN', 'Only the accounts admin does this');
  const r = await db.voucher.updateMany({
    where: { companyId: actor.companyId, tallyState: 'FAILED' },
    data: { tallyState: null, tallyError: null },
  });
  return { again: r.count };
}
