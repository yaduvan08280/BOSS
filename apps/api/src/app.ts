import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { createPrisma, runWithReachSlot, type Db } from '@mono/db';
import type { Env } from './env';
import { EventListener } from './lib/events';
import authPlugin from './plugins/auth';
import errorsPlugin from './plugins/errors';
import originPlugin from './plugins/origin';
import ceilingPlugin from './plugins/ceiling';
import { sseRoutes } from './plugins/sse';
import { authRoutes } from './modules/auth/routes';
import { healthRoutes } from './modules/health/routes';
import { fileRoutes } from './modules/files/routes';
import { companyRoutes } from './modules/org/company.routes';
import { departmentRoutes } from './modules/org/departments.routes';
import { roleRoutes } from './modules/org/roles.routes';
import { setupRoutes } from './modules/org/setup.routes';
import { userRoutes } from './modules/org/users.routes';
import { systemRoutes } from './modules/system/routes';
import { channelRoutes } from './modules/notify/channels.routes';
import { inboxRoutes } from './modules/notify/inbox.routes';
import { ruleRoutes } from './modules/notify/rules.routes';
import { telegramRoutes } from './modules/notify/telegram.routes';
import { templateRoutes } from './modules/notify/templates.routes';
import { checklistRoutes } from './modules/checklist/routes';
import { delegationRoutes } from './modules/delegation/routes';
import { workRoutes } from './modules/work/routes';
import { slipRoutes } from './modules/slip/routes';
import { ticketRoutes } from './modules/ticket/routes';
import { eaRoutes } from './modules/ea/routes';
import { misRoutes } from './modules/mis/routes';
import { fmsRoutes } from './modules/fms/routes';
import { aiRoutes } from './modules/ai/routes';
import { hrRoutes } from './modules/hr/routes';
import { imsRoutes } from './modules/ims/routes';
import { crmRoutes } from './modules/crm/routes';
import { masterRoutes } from './modules/masters/routes';
import { recordRoutes } from './modules/records/routes';
import { listRoutes } from './modules/lists/routes';
import { reportRoutes } from './modules/reports/routes';
import { branchRoutes } from './modules/branches/routes';
import { platformRoutes } from './modules/platform/routes';
import { v1Routes } from './modules/platform/v1';
import { LocalDiskStorage, type Storage } from './lib/storage';
import { DriveAwareStorage } from './modules/integrations/drive-files';
import { driveEnvOf } from './modules/integrations/drive';
import { integrationRoutes } from './modules/integrations/routes';
import { errorRoutes } from './modules/errors/routes';

export type BuildOptions = {
  env: Env;
  prisma?: Db;
  listener?: EventListener;
  storage?: Storage;
  logger?: FastifyServerOptions['logger'];
};

export async function buildApp(opts: BuildOptions) {
  const { env } = opts;
  const app = Fastify({
    logger: opts.logger ?? {
      level: env.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const prisma = opts.prisma ?? createPrisma(env.DATABASE_URL);
  const listener = opts.listener ?? new EventListener(env.DATABASE_URL, app.log);
  app.decorate('prisma', prisma);
  // Every request runs in its own reach slot; `authenticate` fills it once the person is known, and the
  // database client then limits what that request reads (phase 12, plan §3.3).
  app.addHook('onRequest', (_request, _reply, done) => runWithReachSlot(done));
  app.addHook('onClose', async () => {
    await listener.stop();
    if (!opts.prisma) await prisma.$disconnect();
  });
  if (!opts.listener) await listener.start();

  await app.register(errorsPlugin);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  // A ceiling for every API call (routes keep their own limits too), counted per signed-in person: a whole
  // office or outlet sits behind one internet address, so a count per address would lock people out.
  await app.register(ceilingPlugin, {
    secret: env.APP_SECRET,
    perMinute:
      env.API_RATE_LIMIT === '' ? (env.NODE_ENV === 'production' ? 600 : 0) : Number(env.API_RATE_LIMIT) || 0,
  });
  await app.register(originPlugin, { allowed: [env.origin] });
  await app.register(authPlugin, { secret: env.APP_SECRET });

  // OpenAPI docs at /api/docs. In production only the public API (/api/v1) is shown; the app's own routes are hidden.
  const production = env.NODE_ENV === 'production';
  await app.register(swagger, {
    openapi: {
      info: {
        title: `${env.APP_NAME} API`,
        version: '1.0.0',
        description: `The public API is under /api/v1. Send your key (System Master → API Keys) as \`Authorization: Bearer mono_…\` or \`X-Api-Key\`. Money is in paise, sent as strings; dates are YYYY-MM-DD. 120 calls a minute per key.`,
      },
      servers: [{ url: env.origin }],
      components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'mono_…' } } },
    },
    transform: (args) => {
      const out = jsonSchemaTransform(args);
      const hidden = production && !args.url.startsWith('/api/v1');
      return hidden ? { ...out, schema: { ...out.schema, hide: true } } : out;
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  await app.register(healthRoutes);
  await app.register(authRoutes, { env });
  await app.register(sseRoutes, { listener });
  await app.register(fileRoutes, {
    storage:
      opts.storage ?? new DriveAwareStorage(new LocalDiskStorage(env.UPLOAD_DIR), prisma, driveEnvOf(env)),
  });
  await app.register(companyRoutes, { env });
  await app.register(setupRoutes);
  await app.register(departmentRoutes);
  await app.register(userRoutes);
  await app.register(roleRoutes);
  await app.register(systemRoutes);
  await app.register(channelRoutes, { env });
  await app.register(templateRoutes, { env });
  await app.register(ruleRoutes);
  await app.register(telegramRoutes, { env });
  await app.register(inboxRoutes, { env });
  await app.register(delegationRoutes);
  await app.register(checklistRoutes);
  await app.register(workRoutes);
  await app.register(slipRoutes);
  await app.register(ticketRoutes);
  await app.register(eaRoutes);
  await app.register(misRoutes, { appName: env.APP_NAME });
  await app.register(fmsRoutes, { env });
  await app.register(aiRoutes, { env });
  await app.register(hrRoutes);
  await app.register(imsRoutes);
  await app.register(crmRoutes);
  await app.register(masterRoutes);
  await app.register(recordRoutes);
  await app.register(listRoutes);
  await app.register(reportRoutes);
  await app.register(branchRoutes);
  await app.register(platformRoutes, { env });
  await app.register(v1Routes);
  await app.register(integrationRoutes, { env });
  await app.register(errorRoutes);
  // The public API's OpenAPI document (only /api/v1 paths), for code generators and tools like Postman.
  app.get('/api/v1/openapi.json', { schema: { hide: true } }, async () => {
    const spec = app.swagger() as { paths?: Record<string, unknown> };
    const paths = Object.fromEntries(
      Object.entries(spec.paths ?? {}).filter(([p]) => p.startsWith('/api/v1/')),
    );
    return { ...spec, paths };
  });
  return app;
}
