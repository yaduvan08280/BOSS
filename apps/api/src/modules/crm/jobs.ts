import type { Db } from '@mono/db';
import { claimMark } from '../ea/jobs';
import { emitEvent } from '../../lib/events';
import { crmConfigOf, fyCalendar } from './access';
import { customerBook } from './book';
import { generateCalls } from './calls';
import { leadsStuck } from './leads';
import { finishClosedOrders } from './orders';

/**
 * The CRM sweep (worker, every 5 minutes): orders whose after-order record closed are done; once a day the calls
 * are made (SCOT and win-back), leads stuck past their stage's days tell their owner, and customers who have just
 * gone quiet (sleeping) tell their SC once.
 */
export async function crmSweep(db: Db, onlyCompanyId?: string) {
  const companies = await db.crmSettings.findMany({
    where: onlyCompanyId ? { companyId: onlyCompanyId } : {},
    select: { companyId: true },
  });
  let calls = 0;
  for (const { companyId } of companies) {
    await finishClosedOrders(db, companyId);
    const { today } = await fyCalendar(db, companyId);
    if (!(await claimMark(db, companyId, `crm.daily:${today}`))) continue;
    calls += await generateCalls(db, companyId);
    await leadsStuck(db, companyId, (key) => claimMark(db, companyId, key));
    await sleepingCustomers(db, companyId);
  }
  return calls;
}

async function sleepingCustomers(db: Db, companyId: string) {
  const config = await crmConfigOf(db, companyId);
  const { rows } = await customerBook(db, companyId);
  for (const r of rows.filter((x) => x.autoTags.includes('sleeping') && x.lastOrder)) {
    if (!(await claimMark(db, companyId, `crm.sleep:${r.id}:${r.lastOrder}`))) continue;
    const scId = r.handledById ?? config.seats.crrSc?.[0] ?? null;
    if (!scId) continue;
    await db.$transaction((tx) =>
      emitEvent(
        tx,
        { companyId, actorId: null },
        {
          name: 'crm.customer_sleeping',
          entityType: 'customer',
          entityId: r.id,
          payload: { scId, customer: r.name, days: config.customers.sleepingDays, link: '/crm/calls' },
        },
      ),
    );
  }
}
