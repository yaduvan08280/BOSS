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

type App = Awaited<ReturnType<typeof makeApp>>['app'];

/** Sign in and return a small client that sends the session cookie + origin on every call. */
export async function signedIn(app: App, identifier: string, password: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: ORIGIN },
    payload: { identifier, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  let jar = cookieHeader(res);
  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const r = await app.inject({
      method,
      url,
      headers: { cookie: asHeader(jar), origin: ORIGIN },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    jar = cookieHeader(r, jar);
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as any) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body?: unknown) => call('POST', url, body ?? {}),
    put: (url: string, body: unknown) => call('PUT', url, body),
    patch: (url: string, body: unknown) => call('PATCH', url, body),
    del: (url: string) => call('DELETE', url),
  };
}

export async function ownerClient(app: App) {
  const c = await makeCompany(app);
  return { ...c, api: await signedIn(app, c.mobile, c.password) };
}
