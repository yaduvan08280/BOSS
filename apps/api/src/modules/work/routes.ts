import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  checklistSettingsSchema,
  delegationSettingsSchema,
  MODULE_DEFAULTS,
  type ModuleKeyWithSettings,
} from '@mono/shared';
import { AppError } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';
import { pendingCounts } from './counts';
import { moduleSettings } from './settings';

const moduleParam = z.object({
  module: z.enum(Object.keys(MODULE_DEFAULTS) as [ModuleKeyWithSettings, ...ModuleKeyWithSettings[]]),
});

/** Module settings (flow designer UI in phase 4) and the counters shown on the menu and top bar. */
export async function workRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/work/counts', { onRequest: [app.authenticate], schema: { tags: ['work'] } }, async (request) =>
    pendingCounts(app.prisma, request.auth!.companyId, request.auth!.userId),
  );

  r.get(
    '/api/work/settings/:module',
    { onRequest: [app.authenticate], schema: { tags: ['work'], params: moduleParam } },
    async (request) => moduleSettings(app.prisma, request.auth!.companyId, request.params.module),
  );

  r.put(
    '/api/work/settings/:module',
    {
      onRequest: [app.requirePermission('core.admin')],
      schema: { tags: ['work'], params: moduleParam, body: z.record(z.string(), z.unknown()) },
    },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const module = request.params.module;
        const schema = module === 'delegation' ? delegationSettingsSchema : checklistSettingsSchema;
        const before = await moduleSettings(tx, ctx.companyId, module);
        const parsed = schema.safeParse({ ...before, ...request.body });
        if (!parsed.success)
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            parsed.error.issues[0]?.message ?? 'Check the settings',
          );
        await tx.moduleSetting.upsert({
          where: { companyId_module: { companyId: ctx.companyId, module } },
          create: { companyId: ctx.companyId, module, json: parsed.data, changedById: ctx.actorId },
          update: { json: parsed.data, changedById: ctx.actorId },
        });
        await recordChange(tx, ctx, {
          event: 'settings.changed',
          entityType: 'module_setting',
          entityId: module,
          before,
          after: parsed.data,
        });
        return parsed.data;
      }),
  );
}
