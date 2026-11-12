import type { Db } from '@mono/db';
import { formatINR, formatLocalDate, localDate } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import { actorFor } from '../work/actor';
import { imsRulesOf, peoplePayload } from './access';
import { deadStockAlert, openCycle } from './audit';
import { places } from './ledger';
import { tzOf } from './moves';
import { owsList } from './purchase';
import { proposeReviews, snapshotAll } from './review';

/**
 * The inventory sweep (worker, every 5 minutes): today's snapshot for every item, the morning MAX review
 * proposals (once a day), the audit cycle's counts, the OWS "order list ready" message on the day it opens,
 * and the monthly dead-stock message. Only companies that have items.
 */
export async function imsSweep(db: Db, now = new Date(), onlyCompanyId?: string) {
  const withItems = await db.item.groupBy({
    by: ['companyId'],
    where: { deletedAt: null, ...(onlyCompanyId ? { companyId: onlyCompanyId } : {}) },
  });
  const companies = await db.company.findMany({
    where: { deletedAt: null, id: { in: withItems.map((w) => w.companyId) } },
    select: { id: true },
  });
  for (const c of companies) {
    const today = localDate(now, await tzOf(db, c.id));
    await snapshotAll(db, c.id, today);
    if (await claimMark(db, c.id, `ims.review:${today}`)) await proposeReviews(db, c.id, now);
    await openCycle(db, c.id, now);
    await owsReady(db, c.id, now);
    await deadStockAlert(db, c.id, now);
    if (await claimMark(db, c.id, `ims.expiry:${today}`)) await expiryAlert(db, c.id, today);
  }
  return companies.length;
}

async function owsReady(db: Db, companyId: string, now: Date) {
  const rules = await imsRulesOf(db, companyId);
  const who = rules.people.purchaseIds[0];
  if (!who) return;
  const actor = await actorFor(db, companyId, who);
  if (!actor) return;
  const ows = await owsList(db, { ...actor, permissions: [...actor.permissions, 'ims.view'] }, now);
  if (!ows.open || !ows.lines.length || !(await claimMark(db, companyId, `ims.ows:${ows.orderDay}`))) return;
  const value = ows.lines.reduce((s, l) => s + Number(l.valuePaise), 0);
  await db.$transaction((tx) =>
    emitEvent(
      tx,
      { companyId, actorId: null },
      {
        name: 'ims.ows_ready',
        entityType: 'ims_rules',
        entityId: companyId,
        payload: {
          ...peoplePayload(rules),
          count: ows.lines.length,
          date: formatLocalDate(ows.orderDay),
          value: formatINR(value, { compact: true }),
          link: '/ims/purchase',
        },
      },
    ),
  );
}

/**
 * Once a day (phase 13): batches that have expired or will within the rule's days, told branch by branch to the
 * branch's managers (and the owner). Nothing is sent for a branch with nothing to say.
 */
export async function expiryAlert(db: Db, companyId: string, today: string) {
  const rules = await imsRulesOf(db, companyId);
  const days = rules.stock.expiryAlertDays;
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const batches = await db.stockBatch.findMany({ where: { companyId, expiry: { not: null, lte: limit } } });
  if (!batches.length) return 0;
  const held = await db.stockBalance.findMany({
    where: { companyId, batchId: { in: batches.map((b) => b.id) }, qty: { gt: 0 } },
  });
  if (!held.length) return 0;
  const all = await places(db, companyId);
  const items = new Map(
    (
      await db.item.findMany({
        where: { companyId, id: { in: held.map((h) => h.itemId) } },
        select: { id: true, name: true },
      })
    ).map((i) => [i.id, i.name]),
  );
  const byBranch = new Map<string, typeof held>();
  for (const h of held) {
    const key = all.get(h.locationId)?.branchId ?? '';
    byBranch.set(key, [...(byBranch.get(key) ?? []), h]);
  }
  for (const [branchId, rows] of byBranch) {
    const first = rows[0]!;
    const batch = batches.find((b) => b.id === first.batchId)!;
    await db.$transaction((tx) =>
      emitEvent(
        tx,
        { companyId, actorId: null },
        {
          name: 'ims.expiry_soon',
          entityType: 'ims_rules',
          entityId: companyId,
          payload: {
            branchId: branchId || null,
            count: rows.length,
            days,
            first: `${items.get(first.itemId) ?? ''} ${batch.code}, ${formatLocalDate(batch.expiry!)}`,
            link: '/ims/locations?tab=expiry',
          },
        },
      ),
    );
  }
  return byBranch.size;
}
