import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TEMPLATE_CHANNELS, templateSchema, templateVariables } from '@mono/shared';
import type { Env } from '../../env';
import { channelClients } from '../../lib/channels/config';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';
import { loadDefaultTemplates } from './defaults';

const idParam = z.object({ id: z.string() });

export async function templateRoutes(app: FastifyInstance, opts: { env: Env }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { onRequest: [app.requirePermission('integrations.admin')] };

  r.get('/api/notify/templates', { ...admin, schema: { tags: ['notify'] } }, async (request) => {
    const rows = await request.db.template.findMany({
      orderBy: [{ event: 'asc' }, { channel: 'asc' }, { language: 'asc' }],
    });
    return rows.map((t) => ({ ...t, variables: templateVariables(`${t.subject ?? ''} ${t.body}`) }));
  });

  r.post(
    '/api/notify/templates',
    { ...admin, schema: { tags: ['notify'], body: templateSchema } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        if (
          await tx.template.findFirst({
            where: { code: request.body.code, language: request.body.language, deletedAt: null },
          })
        ) {
          throw new AppError(409, 'CONFLICT', 'A template with this code and language already exists');
        }
        const row = await tx.template.create({
          data: {
            ...request.body,
            companyId: ctx.companyId,
            status: request.body.channel === 'whatsapp' ? 'DRAFT' : 'APPROVED',
          },
        });
        await recordChange(tx, ctx, {
          event: 'template.changed',
          entityType: 'template',
          entityId: row.id,
          after: row,
        });
        return row;
      }),
  );

  r.patch(
    '/api/notify/templates/:id',
    { ...admin, schema: { tags: ['notify'], params: idParam, body: templateSchema.partial() } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.template.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!before) throw notFound('Template');
        // Changing the words of a WhatsApp template needs a fresh approval.
        const reapprove =
          before.channel === 'whatsapp' &&
          request.body.body !== undefined &&
          request.body.body !== before.body;
        const row = await tx.template.update({
          where: { id: before.id },
          data: { ...request.body, ...(reapprove ? { status: 'DRAFT' } : {}) },
        });
        await recordChange(tx, ctx, {
          event: 'template.changed',
          entityType: 'template',
          entityId: row.id,
          before,
          after: row,
        });
        return row;
      }),
  );

  r.delete(
    '/api/notify/templates/:id',
    { ...admin, schema: { tags: ['notify'], params: idParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.template.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!before) throw notFound('Template');
        await tx.template.update({
          where: { id: before.id },
          data: { deletedAt: new Date(), active: false },
        });
        await recordChange(tx, ctx, {
          event: 'template.changed',
          entityType: 'template',
          entityId: before.id,
          before,
        });
        return { ok: true };
      }),
  );

  r.post(
    '/api/notify/templates/load-defaults',
    {
      ...admin,
      schema: { tags: ['notify'], body: z.object({ channel: z.enum(TEMPLATE_CHANNELS).optional() }) },
    },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const added = await loadDefaultTemplates(
          tx,
          ctx.companyId,
          request.body.channel ? [request.body.channel] : undefined,
        );
        await recordChange(tx, ctx, {
          event: 'template.changed',
          entityType: 'template',
          entityId: 'defaults',
          payload: { added },
        });
        return { added };
      }),
  );

  /** WhatsApp approval happens at the provider. We mark it pending and tell the admin what to do there. */
  r.post(
    '/api/notify/templates/:id/submit',
    { ...admin, schema: { tags: ['notify'], params: idParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const t = await tx.template.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!t) throw notFound('Template');
        if (t.channel !== 'whatsapp')
          throw new AppError(400, 'BAD_REQUEST', 'Only WhatsApp templates need approval');
        const clients = await channelClients(tx, ctx.companyId, opts.env);
        if (!clients.whatsapp)
          throw new AppError(400, 'BAD_REQUEST', 'Connect a WhatsApp provider first (WhatsApp API tab)');
        await tx.template.update({ where: { id: t.id }, data: { status: 'PENDING' } });
        await recordChange(tx, ctx, {
          event: 'template.changed',
          entityType: 'template',
          entityId: t.id,
          payload: { submitted: true },
        });
        return {
          status: 'PENDING',
          message: `Create a template named "${t.code}" with this text in your ${clients.whatsapp.name.toUpperCase()} dashboard and submit it to WhatsApp. Then press "Check all statuses".`,
        };
      }),
  );

  r.post(
    '/api/notify/templates/check-statuses',
    { ...admin, schema: { tags: ['notify'] } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const clients = await channelClients(tx, ctx.companyId, opts.env);
        if (!clients.whatsapp)
          throw new AppError(400, 'BAD_REQUEST', 'Connect a WhatsApp provider first (WhatsApp API tab)');
        const statuses = await clients.whatsapp.templateStatuses().catch((e: Error) => {
          throw new AppError(400, 'BAD_REQUEST', e.message);
        });
        if (!statuses)
          return {
            updated: 0,
            message: `${clients.whatsapp.name} shows approvals in its own dashboard only.`,
          };
        let updated = 0;
        for (const s of statuses) {
          const res = await tx.template.updateMany({
            where: { channel: 'whatsapp', code: s.name, deletedAt: null },
            data: {
              status: ['APPROVED', 'PENDING', 'REJECTED'].includes(s.status) ? s.status : 'PENDING',
              quality: s.quality ?? null,
              providerTemplateId: s.name,
            },
          });
          updated += res.count;
        }
        return { updated, message: `${updated} template(s) updated from ${clients.whatsapp.name}.` };
      }),
  );
}
