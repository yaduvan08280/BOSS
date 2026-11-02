import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import { misFor, misPdf, misReport } from './service';

const atQuery = z.object({ at: z.iso.datetime({ offset: true }).optional() });

/** Weekly MIS (CLAUDE.md §5.6): everyone sees themselves, HODs their team, admins everyone. */
export async function misRoutes(app: FastifyInstance, opts: { appName: string }) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/mis',
    { onRequest: [app.authenticate], schema: { tags: ['mis'], querystring: atQuery } },
    async (request) =>
      misReport(app.prisma, actorOf(request), request.query.at ? new Date(request.query.at) : new Date()),
  );

  r.get(
    '/api/mis/pdf',
    { onRequest: [app.authenticate], schema: { tags: ['mis'], querystring: atQuery } },
    async (request, reply) => {
      const actor = actorOf(request);
      const report = await misReport(
        app.prisma,
        actor,
        request.query.at ? new Date(request.query.at) : new Date(),
      );
      const company = await app.prisma.company.findUniqueOrThrow({
        where: { id: actor.companyId },
        select: { name: true },
      });
      const pdf = await misPdf(report, company.name, opts.appName);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="mis-${report.week.start}.pdf"`)
        .send(pdf);
    },
  );
}

export { misFor };
