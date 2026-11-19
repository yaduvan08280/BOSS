import { createPrisma } from '@mono/db';
import { loadEnv } from './env';
import { buildApp } from './app';
import { checkSecrets } from './lib/secret-check';
import { recordError } from './modules/errors/service';
import { watchHealth } from './modules/health/alerts';

const env = loadEnv();

/** The database may still be starting (a power cut, a restart of the whole machine): wait for it, up to a minute. */
async function waitForDatabase() {
  const probe = createPrisma(env.DATABASE_URL, { max: 1, name: 'mono-api-start' });
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await probe.$queryRaw`SELECT 1`;
        return;
      } catch (err) {
        if (attempt >= 30) throw err;
        console.warn(`Database not ready (try ${attempt} of 30): ${(err as Error).message.split('\n')[0]}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  } finally {
    await probe.$disconnect().catch(() => undefined);
  }
}

await waitForDatabase();
const app = await buildApp({ env });

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Shutting down: finishing the requests in hand');
  // Requests already being answered are finished; live streams (/api/events) are ended; then the pool closes.
  // A request that will not end does not keep the server up for ever.
  const deadline = setTimeout(() => {
    app.log.error('Shutdown took more than 25 s; stopping now');
    process.exit(1);
  }, 25_000);
  deadline.unref();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: env.HOST, port: env.PORT });

// Watch the installation's health and tell the owners and admins when something stops working (the worker,
// the backups, the disks …). In production only, unless HEALTH_ALERTS=1 asks for it elsewhere.
if (env.NODE_ENV === 'production' || process.env.HEALTH_ALERTS === '1') {
  const startedAt = new Date();
  setInterval(() => {
    if (!closing)
      void watchHealth(app.prisma, env, { startedAt, log: app.log }).catch((err) =>
        app.log.warn({ err }, 'Health watch failed'),
      );
  }, 60_000).unref();
}

const problem = await checkSecrets(app.prisma, env.APP_SECRET).catch(() => null);
if (problem) {
  app.log.error(`SECRET CHECK FAILED: ${problem}`);
  await recordError(app.prisma, { source: 'api', message: problem, path: 'start-up' });
}
