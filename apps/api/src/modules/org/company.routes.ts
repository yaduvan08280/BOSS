import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  appearanceSchema,
  companyProfileSchema,
  contactSchema,
  DEFAULT_THEME,
  normalizeMobile,
} from '@mono/shared';
import type { Env } from '../../env';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { gstProvider, verifyGstin } from '../../lib/gst';
import { inCompanyTx } from '../../lib/tx';

const idParam = z.object({ id: z.string() });

export async function companyRoutes(app: FastifyInstance, opts: { env: Env }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { onRequest: [app.requirePermission('core.admin')] };
  const provider = gstProvider(opts.env.GST_API_PROVIDER, opts.env.GST_API_KEY);

  r.get('/api/org/company', { ...admin, schema: { tags: ['org'] } }, async (request) => {
    const company = await app.prisma.company.findUniqueOrThrow({ where: { id: request.auth!.companyId } });
    const contacts = await request.db.companyContact.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const { settings: _settings, ...profile } = company;
    return { profile, contacts, gstProvider: provider?.name ?? null };
  });

  r.put(
    '/api/org/company',
    { ...admin, schema: { tags: ['org'], body: companyProfileSchema } },
    async (request) => {
      const body = request.body;
      const mobile = normalizeMobile(body.mobile);
      if (!mobile)
        throw new AppError(400, 'VALIDATION_FAILED', 'Enter a valid mobile number', {
          fields: { mobile: 'Invalid' },
        });
      let pan = body.pan;
      if (body.gstin) {
        const check = await verifyGstin(body.gstin, null);
        if (!check.valid) {
          throw new AppError(400, 'VALIDATION_FAILED', 'The GSTIN is not valid', {
            fields: { gstin: check.reason },
          });
        }
        pan = check.pan;
      }
      return inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
        const data = {
          ...body,
          mobile,
          pan,
          email: body.email || null,
          gstin: body.gstin?.toUpperCase() ?? null,
        };
        const after = await tx.company.update({ where: { id: ctx.companyId }, data });
        const { settings: _a, ...b } = before;
        const { settings: _b, ...a } = after;
        await recordChange(tx, ctx, {
          event: 'company.updated',
          entityType: 'company',
          entityId: ctx.companyId,
          before: b,
          after: a,
        });
        return { profile: a };
      });
    },
  );

  r.post(
    '/api/org/company/gst-verify',
    {
      ...admin,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['org'], body: z.object({ gstin: z.string().max(20) }) },
    },
    async (request) => verifyGstin(request.body.gstin, provider),
  );

  r.post('/api/org/contacts', { ...admin, schema: { tags: ['org'], body: contactSchema } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      const count = await tx.companyContact.count({ where: { companyId: ctx.companyId } });
      const row = await tx.companyContact.create({
        data: { ...request.body, companyId: ctx.companyId, sortOrder: count },
      });
      await recordChange(tx, ctx, {
        event: 'contact.created',
        entityType: 'contact',
        entityId: row.id,
        after: row,
      });
      return row;
    }),
  );

  r.patch(
    '/api/org/contacts/:id',
    { ...admin, schema: { tags: ['org'], params: idParam, body: contactSchema.partial() } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.companyContact.findFirst({
          where: { id: request.params.id, deletedAt: null },
        });
        if (!before) throw notFound('Contact');
        const row = await tx.companyContact.update({ where: { id: before.id }, data: request.body });
        await recordChange(tx, ctx, {
          event: 'contact.updated',
          entityType: 'contact',
          entityId: row.id,
          before,
          after: row,
        });
        return row;
      }),
  );

  r.delete(
    '/api/org/contacts/:id',
    { ...admin, schema: { tags: ['org'], params: idParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.companyContact.findFirst({
          where: { id: request.params.id, deletedAt: null },
        });
        if (!before) throw notFound('Contact');
        await tx.companyContact.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
        await recordChange(tx, ctx, {
          event: 'contact.deleted',
          entityType: 'contact',
          entityId: before.id,
          before,
        });
        return { ok: true };
      }),
  );

  r.get('/api/org/appearance', { ...admin, schema: { tags: ['org'] } }, async (request) => {
    const company = await app.prisma.company.findUniqueOrThrow({ where: { id: request.auth!.companyId } });
    return readAppearance(company.settings, opts.env.APP_NAME);
  });

  r.put(
    '/api/org/appearance',
    { ...admin, schema: { tags: ['org'], body: appearanceSchema } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        if (request.body.logoFileId) {
          const file = await tx.attachment.findFirst({
            where: { id: request.body.logoFileId, deletedAt: null },
          });
          if (!file) throw notFound('Logo file');
        }
        const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
        const before = readAppearance(company.settings, opts.env.APP_NAME);
        const settings = { ...(company.settings as Record<string, unknown>), ...request.body };
        await tx.company.update({ where: { id: ctx.companyId }, data: { settings } });
        await recordChange(tx, ctx, {
          event: 'company.updated',
          entityType: 'company',
          entityId: ctx.companyId,
          before,
          after: request.body,
        });
        return request.body;
      }),
  );
}

export function readAppearance(raw: unknown, appName: string) {
  const s = (raw ?? {}) as Record<string, unknown>;
  const parsed = appearanceSchema.partial().safeParse(s);
  const v = parsed.success ? parsed.data : {};
  return {
    appName: v.appName ?? appName,
    theme: v.theme ?? DEFAULT_THEME,
    defaultLang: v.defaultLang ?? 'en',
    defaultThemeMode: v.defaultThemeMode ?? 'system',
    staffMayPickAccent: v.staffMayPickAccent ?? false,
    logoFileId: v.logoFileId ?? null,
  };
}
