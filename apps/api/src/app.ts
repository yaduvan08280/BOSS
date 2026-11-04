import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { createPrisma, type Db } from '@mono/db';
import type { Env } from './env';
import { EventListener } from './lib/events';
import authPlugin from './plugins/auth';
import errorsPlugin from './plugins/errors';
import originPlugin from './plugins/origin';
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
import { LocalDiskStorage, type Storage } from './lib/storage';

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
  app.addHook('onClose', async () => {
    await listener.stop();
    if (!opts.prisma) await prisma.$disconnect();
  });
  if (!opts.listener) await listener.start();

  await app.register(errorsPlugin);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(originPlugin, { allowed: [env.origin] });
  await app.register(authPlugin, { secret: env.APP_SECRET });

  if (env.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: { info: { title: `${env.APP_NAME} API`, version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }

  await app.register(healthRoutes);
  await app.register(authRoutes, { env });
  await app.register(sseRoutes, { listener });
  await app.register(fileRoutes, { storage: opts.storage ?? new LocalDiskStorage(env.UPLOAD_DIR) });
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
  return app;
}
