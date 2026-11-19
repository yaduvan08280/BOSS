import { execSync } from 'node:child_process';
import pg from 'pg';

/**
 * Start every run of the server tests on an empty, fully migrated test database.
 *
 * Tests make their own uniquely named companies and never clean up, so a database kept from run to run
 * grows until the sweeps that look at every company (checklists, reminders) no longer fit a test's time.
 * Only a database whose name ends in "_test" is ever emptied; `TEST_DB_KEEP=1` keeps what is there.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (process.env.TEST_DB_KEEP !== '1') {
    if (!name.endsWith('_test'))
      throw new Error(`Refusing to empty "${name}": the test database's name must end in "_test"`);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const schemas = await client.query<{ nspname: string }>(
        `select nspname from pg_namespace
         where nspname not like 'pg\\_%' and nspname <> 'information_schema'`,
      );
      for (const s of schemas.rows) await client.query(`drop schema if exists "${s.nspname}" cascade`);
      await client.query('create schema public');
    } finally {
      await client.end();
    }
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
