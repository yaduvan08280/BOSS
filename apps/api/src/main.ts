import { loadEnv } from './env';
import { buildApp } from './app';
import { checkSecrets } from './lib/secret-check';
import { recordError } from './modules/errors/service';

const env = loadEnv();
const app = await buildApp({ env });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: env.HOST, port: env.PORT });

const problem = await checkSecrets(app.prisma, env.APP_SECRET).catch(() => null);
if (problem) {
  app.log.error(`SECRET CHECK FAILED: ${problem}`);
  await recordError(app.prisma, { source: 'api', message: problem, path: 'start-up' });
}
