import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { makeLlm, parseJson } from './providers';

/** A stand-in Ollama that streams its answer in pieces that cut lines in half, like a slow CPU does. */
let server: Server;
let base = '';
let reply: string[] = [];
let lastBody: Record<string, unknown> = {};
let lastAuth = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    // OpenAI-compatible (DeepSeek): one JSON answer.
    if (req.url === '/chat/completions') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        lastBody = JSON.parse(body) as Record<string, unknown>;
        lastAuth = req.headers.authorization ?? '';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: '{"ok": true}' } }],
            usage: { prompt_tokens: 50, completion_tokens: 5 },
          }),
        );
      });
      return;
    }
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

describe('DeepSeek (OpenAI-compatible)', () => {
  it('asks for JSON with the key as a bearer token and reads the token counts', async () => {
    const llm = makeLlm({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'sk-test', baseUrl: base });
    const r = await llm.json({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      schema: z.object({ ok: z.boolean() }),
    });
    expect(r).toEqual({ data: { ok: true }, usage: { inputTokens: 50, outputTokens: 5 } });
    expect(llm.provider).toBe('deepseek');
    expect(lastAuth).toBe('Bearer sk-test');
    expect(lastBody).toMatchObject({ model: 'deepseek-flash', response_format: { type: 'json_object' } });
    // JSON mode needs the word "JSON" in the prompt.
    expect(JSON.stringify(lastBody.messages)).toContain('JSON');
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
