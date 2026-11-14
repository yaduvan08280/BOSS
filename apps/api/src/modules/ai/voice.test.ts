import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, testEnv } from '../../test/helpers';
import { world } from '../records/testkit';
import { transcribeFor } from './voice';

/** Speech to text through the company's own Whisper server — a real HTTP call to a server that speaks its API. */
let ctx: Awaited<ReturnType<typeof makeApp>>;
let server: Server;
const got: { url: string; auth: string | undefined; body: string }[] = [];
beforeAll(async () => {
  ctx = await makeApp();
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      got.push({
        url: req.url ?? '',
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString('latin1'),
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: ' कितने काम बाकी हैं ' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
});
afterAll(async () => {
  server.close();
  await ctx.app.close();
});

describe('speech to text', () => {
  it('uses the company’s own Whisper server, with no key, and logs the use', async () => {
    const w = await world(ctx.app);
    const who = { companyId: w.companyId, userId: w.owner.id };
    const clip = Buffer.from('OggS-fake-audio');
    // Nothing set up: refused in a way the callers can tell apart.
    await expect(transcribeFor(ctx.prisma, who, 's', clip, 'audio/ogg', 'hi')).rejects.toMatchObject({
      code: 'AI_NOT_CONNECTED',
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const save = (extra: Record<string, unknown>) =>
      w.api.put('/api/ai/config', {
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'sk-test',
        ...extra,
      });
    // The address is required with this choice.
    expect((await save({ sttProvider: 'whisper' })).status).toBe(400);
    expect((await save({ sttProvider: 'whisper', sttBaseUrl: base })).status).toBe(200);

    expect(await transcribeFor(ctx.prisma, who, testEnv().APP_SECRET, clip, 'audio/ogg', 'hi')).toBe(
      'कितने काम बाकी हैं',
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.url).toBe('/v1/audio/transcriptions');
    // The chat key is never sent to the speech server.
    expect(got[0]!.auth).toBeUndefined();
    expect(got[0]!.body).toContain('OggS-fake-audio');
    expect(got[0]!.body).toContain('name="language"');
    expect(await ctx.prisma.aiUsage.count({ where: { companyId: w.companyId, feature: 'transcribe' } })).toBe(
      1,
    );
    expect((await w.api.get('/api/ai/status')).body.stt).toBe('whisper');
  }, 60_000);
});
