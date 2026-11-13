import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { addDays, localDate } from '@mono/shared';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import { branchLimit, need } from '../hosp/access';
import { outstanding } from '../money/ledger';
import { flashFor } from './flash';
import { gstr1, gstr1Csv, gstrQuery } from './gstr1';
import { auditTrail, salesBy, salesQuery, serviceTimes, spanQuery } from './sales';
import { teamWeek, weekQuery } from './team';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Hospitality reports (phase 20): the flash, sales, kitchen times, the void and discount audit, the team's week, GSTR-1. */
export async function hospReportRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['reports'];
  const db = app.prisma;
  // A fresh hook list per route (decision 62).
  const view = () => ({ onRequest: [app.requirePermission('hosp.view')] });
  const money = () => ({ onRequest: [app.requirePermission('money.view')] });

  r.get('/api/hosp/reports/sales', { ...view(), schema: { tags, querystring: salesQuery } }, async (q) =>
    salesBy(db, actorOf(q), q.query),
  );
  r.get('/api/hosp/reports/service', { ...view(), schema: { tags, querystring: spanQuery } }, async (q) =>
    serviceTimes(db, actorOf(q), q.query),
  );
  r.get('/api/hosp/reports/audit', { ...view(), schema: { tags, querystring: spanQuery } }, async (q) =>
    auditTrail(db, actorOf(q), q.query),
  );
  r.get('/api/hosp/reports/team', { ...view(), schema: { tags, querystring: weekQuery } }, async (q) =>
    teamWeek(db, actorOf(q), q.query),
  );
  r.get(
    '/api/hosp/reports/flash',
    {
      ...view(),
      schema: {
        tags,
        querystring: z.object({ day: day.optional(), branchId: z.string().max(40).optional() }),
      },
    },
    async (q) => {
      const actor = actorOf(q);
      need(actor, 'hosp.view', "You can't see hospitality");
      const company = await db.company.findUniqueOrThrow({
        where: { id: actor.companyId },
        select: { timezone: true },
      });
      // A person sees the flash of their own branches; the day is yesterday unless another is asked.
      const { only } = branchLimit();
      const mine = q.query.branchId ? [q.query.branchId].filter((b) => !only || only.includes(b)) : only;
      return flashFor(
        db,
        actor.companyId,
        q.query.day ?? addDays(localDate(new Date(), company.timezone), -1),
        mine,
      );
    },
  );
  // Who owes: companies and travel agents apart from everyone else.
  r.get(
    '/api/hosp/reports/receivables',
    {
      ...money(),
      schema: {
        tags,
        querystring: z.object({ kind: z.enum(['company', 'agent', 'guest', 'customer']).optional() }),
      },
    },
    async (q) => {
      const actor = actorOf(q);
      const all = await outstanding(db, actor, 'receivable');
      if (!q.query.kind) return all;
      const kinds = new Map(
        (
          await db.party.findMany({
            where: { companyId: actor.companyId, id: { in: all.rows.map((x) => x.party.id) } },
            select: { id: true, kinds: true },
          })
        ).map((p) => [p.id, p.kinds]),
      );
      const rows = all.rows.filter((x) => kinds.get(x.party.id)?.includes(q.query.kind!));
      return { ...all, rows };
    },
  );
  r.get(
    '/api/money/gstr1',
    {
      ...money(),
      schema: { tags, querystring: gstrQuery.extend({ format: z.enum(['json', 'csv']).default('json') }) },
    },
    async (q, reply) => {
      if (q.query.format === 'json') return gstr1(db, actorOf(q), q.query);
      const file = await gstr1Csv(db, actorOf(q), q.query);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${file.fileName}"`)
        .send(file.csv);
    },
  );
}
