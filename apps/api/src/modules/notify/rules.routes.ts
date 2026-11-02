import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { reminderPatternSchema, ruleSchema } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';
import { loadDefaultReminderPatterns, loadDefaultRules } from './defaults';

const idParam = z.object({ id: z.string() });

function checkEscalation(body: { escalateTo?: string | null; escalateAfterMinutes?: number | null }) {
  if (Boolean(body.escalateTo) !== Boolean(body.escalateAfterMinutes)) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Pick both who to escalate to and after how long');
  }
}

/** Notification rules and reminder patterns. */
export async function ruleRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { onRequest: [app.requirePermission('integrations.admin')] };

  r.get('/api/notify/rules', { ...admin, schema: { tags: ['notify'] } }, async (request) =>
    request.db.notificationRule.findMany({ orderBy: [{ event: 'asc' }, { createdAt: 'asc' }] }),
  );

  r.post('/api/notify/rules', { ...admin, schema: { tags: ['notify'], body: ruleSchema } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      checkEscalation(request.body);
      const row = await tx.notificationRule.create({
        data: { ...request.body, companyId: ctx.companyId, createdById: ctx.actorId },
      });
      await recordChange(tx, ctx, {
        event: 'rule.changed',
        entityType: 'rule',
        entityId: row.id,
        after: row,
      });
      return row;
    }),
  );

  r.patch(
    '/api/notify/rules/:id',
    { ...admin, schema: { tags: ['notify'], params: idParam, body: ruleSchema.partial() } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.notificationRule.findFirst({
          where: { id: request.params.id, deletedAt: null },
        });
        if (!before) throw notFound('Rule');
        checkEscalation({ ...before, ...request.body });
        const row = await tx.notificationRule.update({ where: { id: before.id }, data: request.body });
        await recordChange(tx, ctx, {
          event: 'rule.changed',
          entityType: 'rule',
          entityId: row.id,
          before,
          after: row,
        });
        return row;
      }),
  );

  r.delete(
    '/api/notify/rules/:id',
    { ...admin, schema: { tags: ['notify'], params: idParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.notificationRule.findFirst({
          where: { id: request.params.id, deletedAt: null },
        });
        if (!before) throw notFound('Rule');
        await tx.notificationRule.update({
          where: { id: before.id },
          data: { deletedAt: new Date(), active: false },
        });
        await recordChange(tx, ctx, {
          event: 'rule.changed',
          entityType: 'rule',
          entityId: before.id,
          before,
        });
        return { ok: true };
      }),
  );

  r.post('/api/notify/rules/load-defaults', { ...admin, schema: { tags: ['notify'] } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      const added = await loadDefaultRules(tx, ctx.companyId);
      await recordChange(tx, ctx, {
        event: 'rule.changed',
        entityType: 'rule',
        entityId: 'defaults',
        payload: { added },
      });
      return { added };
    }),
  );

  // ---- Reminder patterns ----
  r.get('/api/notify/reminders', { ...admin, schema: { tags: ['notify'] } }, async (request) =>
    request.db.reminderPattern.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
  );

  r.post(
    '/api/notify/reminders',
    { ...admin, schema: { tags: ['notify'], body: reminderPatternSchema } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        if (request.body.isDefault)
          await tx.reminderPattern.updateMany({
            where: { companyId: ctx.companyId },
            data: { isDefault: false },
          });
        const row = await tx.reminderPattern.create({ data: { ...request.body, companyId: ctx.companyId } });
        await recordChange(tx, ctx, {
          event: 'reminder.changed',
          entityType: 'reminder',
          entityId: row.id,
          after: row,
        });
        return row;
      }),
  );

  r.patch(
    '/api/notify/reminders/:id',
    { ...admin, schema: { tags: ['notify'], params: idParam, body: reminderPatternSchema.partial() } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.reminderPattern.findFirst({
          where: { id: request.params.id, deletedAt: null },
        });
        if (!before) throw notFound('Reminder pattern');
        if (request.body.isDefault)
          await tx.reminderPattern.updateMany({
            where: { companyId: ctx.companyId },
            data: { isDefault: false },
          });
        const row = await tx.reminderPattern.update({ where: { id: before.id }, data: request.body });
        await recordChange(tx, ctx, {
          event: 'reminder.changed',
          entityType: 'reminder',
          entityId: row.id,
          before,
          after: row,
        });
        return row;
      }),
  );

  r.delete(
    '/api/notify/reminders/:id',
    { ...admin, schema: { tags: ['notify'], params: idParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.reminderPattern.findFirst({
          where: { id: request.params.id, deletedAt: null },
        });
        if (!before) throw notFound('Reminder pattern');
        if (before.isDefault) throw new AppError(409, 'CONFLICT', 'Make another pattern the default first');
        await tx.reminderPattern.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
        await recordChange(tx, ctx, {
          event: 'reminder.changed',
          entityType: 'reminder',
          entityId: before.id,
          before,
        });
        return { ok: true };
      }),
  );

  r.post('/api/notify/reminders/load-defaults', { ...admin, schema: { tags: ['notify'] } }, async (request) =>
    inCompanyTx(request, async (tx) => ({
      added: await loadDefaultReminderPatterns(tx, request.auth!.companyId),
    })),
  );
}
