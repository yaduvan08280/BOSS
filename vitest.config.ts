import 'dotenv/config';
import { defineConfig } from 'vitest/config';

const dbEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://mono:mono@localhost:5432/mono_test',
};

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', include: ['packages/shared/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'] } },
      {
        test: {
          name: 'server',
          include: [
            'packages/db/src/**/*.test.ts',
            'apps/api/src/**/*.test.ts',
            'apps/worker/src/**/*.test.ts',
          ],
          env: dbEnv,
          globalSetup: ['test/global-setup.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
