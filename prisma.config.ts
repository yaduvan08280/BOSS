import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Falls back to a placeholder so `prisma generate` works without a database (e.g. in CI / Docker build).
    url: process.env.DATABASE_URL ?? 'postgresql://mono:mono@localhost:5432/mono',
  },
});
