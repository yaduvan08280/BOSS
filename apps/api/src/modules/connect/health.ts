import type { Db } from '@mono/db';
import { AppError } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { listConnections } from './connections';

/**
 * Phase 19 — is everything that talks to the outside world working? One answer for the health screen: each
 * connection with what waits or failed, bookings a channel oversold, payments that came in but could not be
 * recorded, site agents and when each was last heard, print jobs waiting for them, vouchers waiting for Tally.
 */
export async function integrationHealth(db: Db, actor: Actor, now = new Date()) {
  if (!can(actor, 'integrations.view')) throw new AppError(403, 'FORBIDDEN', "You can't see integrations");
  const where = { companyId: actor.companyId };
  const [connections, overbooked, stuck, agents, printers, waiting, failed] = await Promise.all([
    listConnections(db, actor),
    db.stay.count({ where: { ...where, overbooked: true, status: 'BOOKED' } }),
    db.payLink.findMany({
      where: { ...where, status: 'CREATED', note: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.agentToken.findMany({ where: { ...where, revokedAt: null }, orderBy: { createdAt: 'asc' } }),
    db.printer.findMany({ where: { ...where, deletedAt: null, connection: 'AGENT' }, select: { id: true } }),
    db.voucher.count({ where: { ...where, tallyState: null } }),
    db.voucher.count({ where: { ...where, tallyState: 'FAILED' } }),
  ]);
  const printWaiting = await db.printJob.count({
    where: { ...where, status: 'QUEUED', printerId: { in: printers.map((p) => p.id) } },
  });
  const quiet = (at: Date | null) => !at || now.getTime() - at.getTime() > 10 * 60_000;
  const agentRows = agents.map((a) => ({
    id: a.id,
    name: a.name,
    branchId: a.branchId,
    lastSeenAt: a.lastSeenAt,
    // An agent polls every few seconds: ten quiet minutes means it is off.
    online: !quiet(a.lastSeenAt),
  }));
  const problems =
    connections.filter((c) => c.active && (c.failed > 0 || (c.lastError && !c.lastOkAt))).length +
    (overbooked ? 1 : 0) +
    stuck.length +
    agentRows.filter((a) => !a.online).length +
    (failed ? 1 : 0);
  return {
    ok: problems === 0,
    problems,
    connections,
    overbooked,
    payments: stuck.map((l) => ({
      id: l.id,
      purpose: l.purpose,
      refId: l.refId,
      amount: Number(l.amount),
      note: l.note,
    })),
    agents: agentRows,
    printWaiting,
    // Tally posting matters only where an agent is set up; the numbers are shown either way.
    tally: { waiting, failed },
  };
}
