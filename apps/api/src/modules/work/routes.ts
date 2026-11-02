import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ENGINE_MODULES,
  ENGINE_ROLES,
  MODULE_DEFAULTS,
  MODULE_SETTINGS_SCHEMAS,
  NOTIFY_EVENTS,
  type ModuleKeyWithSettings,
} from '@mono/shared';
import { AppError } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';
import { checkPerson } from './actor';
import { pendingCounts } from './counts';
import { moduleSettings } from './settings';

const moduleParam = z.object({
  module: z.enum(Object.keys(MODULE_DEFAULTS) as [ModuleKeyWithSettings, ...ModuleKeyWithSettings[]]),
});

/**
 * Module settings and the Business Engine flow designer (CLAUDE.md §5), plus the counters
 * shown on the menu and top bar. Saved settings change the state machines' guards at once.
 */
export async function workRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { onRequest: [app.requirePermission('core.admin')] };

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
    { ...admin, schema: { tags: ['work'], params: moduleParam, body: z.record(z.string(), z.unknown()) } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const module = request.params.module;
        const before = await moduleSettings(tx, ctx.companyId, module);
        const parsed = MODULE_SETTINGS_SCHEMAS[module].safeParse({ ...before, ...request.body });
        if (!parsed.success)
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            parsed.error.issues[0]?.message ?? 'Check the settings',
          );
        // Person pickers (eaUserId, receiverUserId…) must point at active people.
        for (const [k, v] of Object.entries(parsed.data))
          if (k.endsWith('UserId') && typeof v === 'string')
            await checkPerson(tx, ctx.companyId, v, 'That person');
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

  // "Reset to default": forget the company's own settings.
  r.delete(
    '/api/work/settings/:module',
    { ...admin, schema: { tags: ['work'], params: moduleParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const module = request.params.module;
        const before = await moduleSettings(tx, ctx.companyId, module);
        await tx.moduleSetting.deleteMany({ where: { companyId: ctx.companyId, module } });
        await recordChange(tx, ctx, {
          event: 'settings.changed',
          entityType: 'module_setting',
          entityId: module,
          before,
          after: MODULE_DEFAULTS[module],
        });
        return MODULE_DEFAULTS[module];
      }),
  );

  /** Every module on the flow designer: its settings, "Default" or not, alerts n/n and the roles legend. */
  r.get('/api/engine', { ...admin, schema: { tags: ['work'] } }, async (request) => {
    const companyId = request.auth!.companyId;
    const [rows, rules] = await Promise.all([
      app.prisma.moduleSetting.findMany({ where: { companyId } }),
      app.prisma.notificationRule.findMany({
        where: { companyId, deletedAt: null, active: true },
        select: { event: true, recipients: true, channels: true },
      }),
    ]);
    return Promise.all(
      ENGINE_MODULES.map(async (module) => {
        const row = rows.find((x) => x.module === module);
        const events = NOTIFY_EVENTS.filter((e) => e.module === module).map((e) => e.event);
        const mine = rules.filter((x) => events.includes(x.event));
        return {
          module,
          settings: await moduleSettings(app.prisma, companyId, module),
          custom: Boolean(row),
          changedAt: row?.updatedAt ?? null,
          alerts: { active: new Set(mine.map((x) => x.event)).size, total: events.length },
          roles: ENGINE_ROLES[module].map((role) => ({
            role,
            telegram: [
              ...new Set(
                mine
                  .filter(
                    (x) =>
                      x.channels.includes('telegram') &&
                      (x.recipients.includes(role) || (role === 'owner' && x.recipients.includes('owner'))),
                  )
                  .map((x) => x.event),
              ),
            ],
          })),
        };
      }),
    );
  });

  /** "Recent changes by admin" for one module. */
  r.get(
    '/api/engine/:module/changes',
    { ...admin, schema: { tags: ['work'], params: moduleParam } },
    async (request) => {
      const rows = await request.db.auditLog.findMany({
        where: { entityType: 'module_setting', entityId: request.params.module },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      const ids = rows.map((x) => x.actorId).filter((x): x is string => Boolean(x));
      const names = new Map(
        (
          await request.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        ).map((u) => [u.id, u.name]),
      );
      return rows.map((x) => ({
        id: x.id,
        createdAt: x.createdAt,
        actorName: x.actorId ? (names.get(x.actorId) ?? '?') : null,
        before: x.before,
        after: x.after,
      }));
    },
  );
}
