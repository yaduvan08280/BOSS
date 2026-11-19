import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migrations', () => {
  it('leave the database exactly as the schema files describe it (no drift)', () => {
    // The test database was just migrated from empty (test/global-setup.ts). If the schema files say
    // anything the migrations did not do — a column, an index — this prints the difference and fails.
    const root = join(import.meta.dirname, '../../..');
    const run = () =>
      execFileSync(
        'npx',
        ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema', '--script'],
        { cwd: root, encoding: 'utf8', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' } },
      );
    const sql = run()
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('--') && !l.startsWith('Loaded Prisma config'))
      .join('\n');
    expect(sql).toBe('');
  }, 120_000);
});
