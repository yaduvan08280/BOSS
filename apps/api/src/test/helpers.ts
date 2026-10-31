import type { LightMyRequestResponse } from 'fastify';
import { createPrisma } from '@mono/db';
import { buildApp } from '../app';
import { loadEnv } from '../env';
import { bootstrapCompany } from '../modules/core/bootstrap';

export const ORIGIN = 'http://localhost:5173';

export function testEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_SECRET: 'test-secret-that-is-long-enough-1234567890',
    BASE_URL: ORIGIN,
    LOG_LEVEL: 'silent',
    LOGIN_RATE_LIMIT: '100',
    ...overrides,
  });
}

export async function makeApp(overrides: Record<string, string> = {}) {
  const prisma = createPrisma();
  const app = await buildApp({ env: testEnv(overrides), prisma, logger: false });
  app.addHook('onClose', async () => prisma.$disconnect());
  return { app, prisma };
}

let seq = 0;
/** A fresh company + owner with a unique mobile/email. */
export async function makeCompany(
  app: Awaited<ReturnType<typeof makeApp>>['app'],
  over: Partial<{ mobile: string; email: string; name: string }> = {},
) {
  seq += 1;
  const n = `${Date.now() % 1_000_000}`.padStart(6, '0') + String(seq).padStart(3, '0');
  const mobile = over.mobile ?? `9${n.slice(-9)}`;
  const email = over.email ?? `owner${n}@example.com`;
  const { company, owner } = await bootstrapCompany(app.prisma, {
    companyName: over.name ?? `Test Co ${n}`,
    ownerName: 'Test Owner',
    ownerMobile: mobile,
    ownerEmail: email,
    ownerPassword: 'Secret123',
  });
  return { company, owner: owner!, mobile, email, password: 'Secret123' };
}

export function cookieHeader(res: LightMyRequestResponse, existing: Record<string, string> = {}) {
  const jar = { ...existing };
  for (const c of res.cookies as { name: string; value: string }[]) {
    if (c.value) jar[c.name] = c.value;
    else delete jar[c.name];
  }
  return jar;
}

export const asHeader = (jar: Record<string, string>) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
