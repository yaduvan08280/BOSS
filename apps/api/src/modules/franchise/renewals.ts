import type { Db } from '@mono/db';
import {
  branchDetailsSchema,
  entityDetailsSchema,
  formatLocalDate,
  localDate,
  type Licence,
} from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';

/** Days before the last day at which a reminder goes out (and on the day itself). */
const THRESHOLDS = [30, 7, 0] as const;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Daily (phase 12, plan §3.8 / §3.9): licences of every entity and branch, and franchise agreements, are watched
 * for their last day. The owner and the branch's managers are told 30 days before, 7 days before and on the day
 * — once each. Something already past is told once (as "0 days left") and then left alone.
 */
export async function watchRenewals(db: Db, now = new Date(), onlyCompanyId?: string): Promise<number> {
  let sent = 0;
  for (const c of await db.company.findMany({
    where: { deletedAt: null, ...(onlyCompanyId ? { id: onlyCompanyId } : {}) },
    select: { id: true, timezone: true },
  })) {
    const today = localDate(now, c.timezone);
    const [entities, branches] = await Promise.all([
      db.legalEntity.findMany({ where: { companyId: c.id, deletedAt: null } }),
      db.branch.findMany({ where: { companyId: c.id, deletedAt: null } }),
    ]);
    if (!entities.length && !branches.length) continue;
    type Due = { key: string; what: string; place: string; date: string; branchId: string | null };
    const due: Due[] = [];
    const licences = (key: string, place: string, branchId: string | null, list: Licence[] | undefined) => {
      for (const l of list ?? [])
        if (l.validTill)
          due.push({
            key: `${key}:${l.name}`,
            what: `${l.name} licence`,
            place,
            date: l.validTill,
            branchId,
          });
    };
    for (const e of entities) {
      const d = entityDetailsSchema.safeParse(e.details).data ?? {};
      const first = branches.find((b) => b.entityId === e.id)?.id ?? null;
      licences(`e:${e.id}`, e.name, first, d.licences);
      if (d.franchise?.agreementEnd)
        due.push({
          key: `e:${e.id}:agreement`,
          what: 'Franchise agreement',
          place: e.name,
          date: d.franchise.agreementEnd,
          branchId: first,
        });
    }
    for (const b of branches)
      licences(`b:${b.id}`, b.name, b.id, branchDetailsSchema.safeParse(b.details).data?.licences);
    for (const x of due) {
      const left = daysBetween(today, x.date);
      // The tightest mark reached that has not been told yet; earlier marks are taken with it.
      let tell = false;
      for (const t of THRESHOLDS)
        if (left <= t && (await claimMark(db, c.id, `renewal:${x.key}:${x.date}:${t}`))) tell = true;
      if (!tell) continue;
      await db.$transaction((tx) =>
        emitEvent(
          tx,
          { companyId: c.id, actorId: null },
          {
            name: 'franchise.renewal_due',
            entityType: 'renewal',
            entityId: x.key,
            payload: {
              branchId: x.branchId,
              what: x.what,
              place: x.place,
              date: formatLocalDate(x.date),
              daysLeft: Math.max(0, left),
              link: '/system/branches',
            },
          },
        ),
      );
      sent++;
    }
  }
  return sent;
}
