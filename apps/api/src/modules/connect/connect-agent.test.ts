import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The site agent is a plain Node program shipped in /deploy; the test drives its real code.
// @ts-expect-error — a .mjs file with no types
import { postToTally, runOnce } from '../../../../../deploy/site-agent/agent.mjs';
import { makeApp } from '../../test/helpers';
import { add, bill, ok, open, pay, post, restaurant } from '../hosp/pos-kit';
import { world } from '../records/testkit';
import { actor } from './connect-kit';
import { integrationHealth } from './health';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('Integrations: the site agent, Tally, health (phase 19)', { timeout: 120_000 }, () => {
  it('X17, X18, X19, X20: a site agent with its own key prints the branch’s jobs and posts vouchers to Tally; health shows what is wrong', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const branchId = r.g.b.rooftop.id;
    // The bar's printer is the agent's; the cash desk's too.
    await ctx.prisma.printer.updateMany({
      where: { companyId: w.companyId },
      data: { connection: 'AGENT', address: '/dev/usb/lp0' },
    });
    expect((await s.post('/api/connect/agents', { branchId, name: 'Rooftop PC' })).status).toBe(403);
    const made = await post<{ id: string; key: string; prefix: string }>(w.api, '/api/connect/agents', {
      branchId,
      name: 'Rooftop PC',
    });
    expect(made.key).toMatch(/^agt_[0-9a-f]{12}_/);
    // Only its hash is kept, and the list never shows the key again.
    const row = await ctx.prisma.agentToken.findUniqueOrThrow({ where: { id: made.id } });
    expect(made.key).not.toContain(row.hash);
    expect(JSON.stringify(row)).not.toContain(made.key.split('_')[2]);
    expect(JSON.stringify(await ok(w.api.get('/api/connect/agents')))).not.toContain(made.key.split('_')[2]);
    const other = await post<{ key: string }>(w.api, '/api/connect/agents', {
      branchId: r.g.b.lake.id,
      name: 'Lake PC',
    });

    // A cola goes to the bar (a ticket) and the order is billed (a bill): two jobs wait for the agent.
    const o = await open(s, r, 'T1');
    await add(s, o.id, [{ menuItemId: r.m.cola, qty: 2 }]);
    const c = await bill(s, o.id);
    await pay(s, c.id, [{ modeId: r.modes.cash, amount: c.total }]);
    // The agent talks to MONO over HTTP: here, straight into the app.
    const viaApp = async (url: string, init?: RequestInit) => {
      const res = await ctx.app.inject({
        method: (init?.method ?? 'GET') as 'GET',
        url: new URL(url).pathname,
        headers: init?.headers as Record<string, string>,
        payload: init?.body as string | undefined,
      });
      return new Response(res.body, { status: res.statusCode });
    };
    const printed: { address: string; text: string }[] = [];
    const agent = (key: string, more: object = {}) =>
      runOnce({
        server: 'http://mono.test',
        key,
        fetch: viaApp,
        print: async (address: string, bytes: Buffer) =>
          void printed.push({ address, text: bytes.toString('latin1') }),
        ...more,
      });
    await expect(agent('agt_000000000000_wrongwrongwrongwrongwrong')).rejects.toThrow('401');
    // The other branch's agent gets nothing of this branch.
    expect(await agent(other.key)).toMatchObject({ printed: 0 });
    let first = true;
    const round = await agent(made.key, {
      print: async (address: string, bytes: Buffer) => {
        // The first job jams once.
        if (first) {
          first = false;
          throw new Error('Paper out');
        }
        printed.push({ address, text: bytes.toString('latin1') });
      },
    });
    expect(round).toMatchObject({ printed: 1, printFailed: 1 });
    // The jammed job is still queued with its reason, and prints on the next round.
    expect(
      await ctx.prisma.printJob.findFirst({ where: { companyId: w.companyId, status: 'QUEUED' } }),
    ).toMatchObject({ error: 'Paper out', tries: 1 });
    expect(await agent(made.key)).toMatchObject({ printed: 1, printFailed: 0 });
    expect(printed.map((p) => p.address)).toEqual(['/dev/usb/lp0', '/dev/usb/lp0']);
    expect(printed.some((p) => p.text.includes('2 x Cola'))).toBe(true);
    expect(await ctx.prisma.printJob.count({ where: { companyId: w.companyId, status: 'SENT' } })).toBe(2);

    // Tally. Nothing is posted while a head has no ledger: the agent is told which.
    const tallied: string[] = [];
    const tally = async (xml: string) => {
      tallied.push(xml);
      return xml.includes('Receipt') ? { ok: false, error: 'Ledger "Cash" does not exist' } : { ok: true };
    };
    const blocked = await agent(made.key, { tally });
    expect(blocked.posted).toBe(0);
    expect(blocked.unmapped.length).toBeGreaterThan(0);
    await ok(
      w.api.put('/api/money/tally/map', {
        rows: blocked.unmapped.map((head: string) => ({ head, ledger: `L ${head}` })),
      }),
    );
    const posted = await agent(made.key, { tally });
    // The sale posts; Tally refuses the receipt and says why.
    expect(posted).toMatchObject({ posted: 1, postFailed: 1, unmapped: [] });
    expect(tallied[0]).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(tallied[0]).toContain(c.number);
    type Queue = { waiting: number; posted: number; failed: { error: string }[] };
    expect(await ok<Queue>(w.api.get('/api/connect/tally'))).toMatchObject({
      waiting: 0,
      posted: 1,
      failed: [{ error: 'Ledger "Cash" does not exist' }],
    });
    // Health: Tally has a failure; the Lake agent has never called.
    const health = await integrationHealth(ctx.prisma, await actor(ctx.prisma, w.companyId, w.owner.id));
    expect(health).toMatchObject({ ok: false, tally: { waiting: 0, failed: 1 }, printWaiting: 0 });
    expect(health.agents).toMatchObject([
      { name: 'Rooftop PC', online: true },
      { name: 'Lake PC', online: true },
    ]);
    const quiet = await integrationHealth(
      ctx.prisma,
      await actor(ctx.prisma, w.companyId, w.owner.id),
      new Date(Date.now() + 11 * 60_000),
    );
    expect(quiet.agents.every((a) => !a.online)).toBe(true);
    // Sent again after the ledger is made in Tally: it posts, and nothing is posted twice.
    expect(await ok(w.api.post('/api/connect/tally/retry'))).toEqual({ again: 1 });
    expect(await agent(made.key, { tally: async () => ({ ok: true }) })).toMatchObject({ posted: 1 });
    expect(await agent(made.key, { tally })).toMatchObject({ posted: 0, postFailed: 0 });
    expect(
      (await integrationHealth(ctx.prisma, await actor(ctx.prisma, w.companyId, w.owner.id))).tally,
    ).toEqual({ waiting: 0, failed: 0 });
    // Tally's own answer is read for what it did.
    const reply = (body: string) => async () => new Response(body, { status: 200 });
    expect(
      await postToTally(
        'http://tally',
        '<x/>',
        reply('<RESPONSE><CREATED>1</CREATED><ERRORS>0</ERRORS></RESPONSE>'),
      ),
    ).toEqual({ ok: true });
    expect(
      await postToTally(
        'http://tally',
        '<x/>',
        reply('<RESPONSE><LINEERROR>Voucher date is missing</LINEERROR><CREATED>0</CREATED></RESPONSE>'),
      ),
    ).toEqual({ ok: false, error: 'Voucher date is missing' });
    // A revoked key stops working.
    await ok(w.api.del(`/api/connect/agents/${made.id}`));
    await expect(agent(made.key)).rejects.toThrow('401');
  });
});
