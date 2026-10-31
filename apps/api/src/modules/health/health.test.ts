import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asHeader, cookieHeader, makeApp, makeCompany, ORIGIN } from '../../test/helpers';
import { recordChange } from '../../lib/events';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx.app.close();
});

describe('health', () => {
  it('reports ok with the database up', async () => {
    const res = await ctx.app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('returns the error shape for unknown routes', async () => {
    const res = await ctx.app.inject({ url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('live events (SSE)', () => {
  it('streams committed events of my company only', async () => {
    const mine = await makeCompany(ctx.app);
    const other = await makeCompany(ctx.app);
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { identifier: mine.mobile, password: mine.password },
    });
    const cookie = asHeader(cookieHeader(login));
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const res = await fetch(`${address}/api/events`, { headers: { cookie }, signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil('event: ready');

    // Rolled-back events must never arrive; other companies' events must never arrive.
    await ctx.prisma
      .$transaction(async (tx) => {
        await recordChange(
          tx,
          { companyId: mine.company.id, actorId: null },
          {
            event: 'user.created',
            entityType: 'user',
            entityId: 'rolled-back',
          },
        );
        throw new Error('rollback');
      })
      .catch(() => undefined);
    await ctx.prisma.$transaction((tx) =>
      recordChange(
        tx,
        { companyId: other.company.id, actorId: null },
        {
          event: 'user.created',
          entityType: 'user',
          entityId: 'other-company',
        },
      ),
    );
    await ctx.prisma.$transaction((tx) =>
      recordChange(
        tx,
        { companyId: mine.company.id, actorId: null },
        {
          event: 'user.created',
          entityType: 'user',
          entityId: 'committed',
        },
      ),
    );
    await readUntil('committed');
    controller.abort();
    expect(text).toContain('"entityId":"committed"');
    expect(text).not.toContain('rolled-back');
    expect(text).not.toContain('other-company');
  });
});
