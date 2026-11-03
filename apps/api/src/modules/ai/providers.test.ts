import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { makeLlm, parseJson } from './providers';

/** A stand-in Ollama that streams its answer in pieces that cut lines in half, like a slow CPU does. */
let server: Server;
let base = '';
let reply: string[] = [];
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const parts = [...reply];
    const next = () => {
      const p = parts.shift();
      if (p === undefined) return res.end();
      res.write(p);
      setTimeout(next, 5);
    };
    next();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const line = (o: object) => `${JSON.stringify(o)}\n`;

describe('Ollama (streamed)', () => {
  it('joins the streamed words, even when a line is split across pieces, and reads the token counts', async () => {
    const all =
      line({ message: { content: '{"ok":' }, done: false }) +
      line({ message: { content: ' true}' }, done: false }) +
      line({ message: { content: '' }, done: true, prompt_eval_count: 120, eval_count: 7 });
    reply = [all.slice(0, 13), all.slice(13, 60), all.slice(60)];
    const llm = makeLlm({ provider: 'ollama', model: 'qwen2.5:7b', baseUrl: base });
    const r = await llm.json({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      schema: z.object({ ok: z.boolean() }),
    });
    expect(r).toEqual({ data: { ok: true }, usage: { inputTokens: 120, outputTokens: 7 } });
  });
  it('reports an error the model sends', async () => {
    reply = [line({ error: 'model "x" not found' })];
    const llm = makeLlm({ provider: 'ollama', model: 'x', baseUrl: base });
    await expect(llm.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] })).rejects.toThrow(
      /not found/,
    );
  });
});

describe('reading JSON answers', () => {
  const schema = z.object({ n: z.number() });
  it('takes fenced or bare JSON and names what does not match', () => {
    expect(parseJson('Here you go:\n```json\n{"n": 2}\n```', schema)).toEqual({ ok: true, data: { n: 2 } });
    expect(parseJson('{"n": 3}', schema)).toEqual({ ok: true, data: { n: 3 } });
    expect(parseJson('{"n": "x"}', schema)).toMatchObject({
      ok: false,
      error: expect.stringContaining('n:'),
    });
    expect(parseJson('no json here', schema)).toMatchObject({ ok: false });
  });
});
