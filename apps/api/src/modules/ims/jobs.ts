import type { Db } from '@mono/db';
import { formatINR, formatLocalDate, localDate } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import { actorFor } from '../work/actor';
import { imsRulesOf, peoplePayload } from './access';
import { deadStockAlert, openCycle } from './audit';
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
