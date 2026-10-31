import { execSync } from 'node:child_process';

/**
 * Bring the dedicated test database up to the latest migration.
 * Tests create their own uniquely named companies, so nothing needs wiping between runs.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
