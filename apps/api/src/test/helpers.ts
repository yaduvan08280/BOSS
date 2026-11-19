import { randomInt } from 'node:crypto';
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
  // Nine random digits: the test database is kept between runs, and a name made from the clock alone comes
  // round again (and two test files can start in the same millisecond) — which hands a test someone else's company.
  const n =
    String(randomInt(0, 1_000_000)).padStart(6, '0') +
    String((seq + randomInt(0, 1000)) % 1000).padStart(3, '0');
  const mobile = over.mobile ?? `9${n.slice(-9)}`;
  const email = over.email ?? `owner${n}@example.com`;
  const { company, owner } = await bootstrapCompany(app.prisma, {
    companyName: over.name ?? `Test Co ${n} ${randomInt(0, 1_000_000_000).toString(36)}`,
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
    extra: Record<string, string> = {},
  ) => {
    const r = await app.inject({
      method,
      url,
      headers: { cookie: asHeader(jar), origin: ORIGIN, ...extra },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    jar = cookieHeader(r, jar);
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as any) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return {
    /** `headers`: extra request headers (the top bar's branch switcher sends `x-mono-branch`). */
    get: (url: string, headers?: Record<string, string>) => call('GET', url, undefined, headers),
    post: (url: string, body?: unknown) => call('POST', url, body ?? {}),
    put: (url: string, body: unknown) => call('PUT', url, body),
    patch: (url: string, body: unknown) => call('PATCH', url, body),
    del: (url: string) => call('DELETE', url),
    /** A download: the whole response (headers, `body` as text, `rawPayload` as bytes). */
    raw: (url: string) =>
      app.inject({ method: 'GET', url, headers: { cookie: asHeader(jar), origin: ORIGIN } }),
  };
}

export async function ownerClient(app: App) {
  const c = await makeCompany(app);
  return { ...c, api: await signedIn(app, c.mobile, c.password) };
}

/**
 * The same database client, counting what a job asks it: every call on a model (`task.findMany`) and the rows
 * the reads bring back (`read` keeps the rows, so a test can look at its own company's only). For tests that prove a sweep does not read again what it has already dealt with.
 */
export function counting<T extends object>(db: T) {
  const seen = { calls: [] as string[], rows: 0, read: [] as Record<string, unknown>[] };
  const proxy = new Proxy(db, {
    get(target, model) {
      const m = (target as Record<string | symbol, unknown>)[model];
      if (typeof m === 'function') {
        // Hand-written SQL (`$queryRaw`, `$executeRaw`) is counted under its own name.
        if (typeof model === 'string' && /^\$(query|execute)/.test(model))
          return (...args: unknown[]) => {
            seen.calls.push(model);
            return (m as (...a: unknown[]) => unknown).apply(target, args);
          };
        return m.bind(target);
      }
      if (!m || typeof m !== 'object' || typeof model !== 'string' || model.startsWith('$')) return m;
      return new Proxy(m, {
        get(delegate, fn) {
          const f = (delegate as Record<string | symbol, unknown>)[fn];
          if (typeof f !== 'function') return f;
          return async (...args: unknown[]) => {
            seen.calls.push(`${model}.${String(fn)}`);
            const r = await (f as (...a: unknown[]) => Promise<unknown>).apply(delegate, args);
            if (Array.isArray(r)) {
              seen.rows += r.length;
              seen.read.push(...(r as Record<string, unknown>[]));
            }
            return r;
          };
        },
      });
    },
  });
  return { db: proxy, seen };
}
