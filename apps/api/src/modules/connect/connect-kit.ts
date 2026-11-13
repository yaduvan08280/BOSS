import type { PrismaClient } from '@mono/db';
import { actorFor, type Actor } from '../work/actor';
import type { Net } from './core';

export const SECRET = 'test-secret-that-is-long-enough-1234567890';
export type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
/**
 * The outside world for a test: every call is kept, and `answer` says what the service replies (a status and a
 * JSON body; 200 and {} when it says nothing).
 */
export function outside(answer: (c: Call) => { status?: number; json?: unknown } | void = () => undefined) {
  const calls: Call[] = [];
  const net: Net = {
    secret: SECRET,
    baseUrl: 'http://localhost:5173',
    fetch: async (url, init) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      const a = answer(call) ?? {};
      return new Response(JSON.stringify(a.json ?? {}), { status: a.status ?? 200 });
    },
  };
  return { net, calls };
}
export const actor = async (prisma: PrismaClient, companyId: string, userId: string): Promise<Actor> =>
  (await actorFor(prisma, companyId, userId))!;
