import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { AiProvider } from '@mono/shared';
import { AppError } from '../../lib/errors';

/** CLAUDE.md §13: `complete` for text, `json` for an answer that must match a zod schema. */
export type LlmMessage = { role: 'user' | 'assistant'; content: string };
export type LlmUsage = { inputTokens: number; outputTokens: number };
export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  /** How hard to think: low for short answers, medium for drafting a process. */
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
};
export interface Llm {
  provider: AiProvider;
  model: string;
  complete(req: LlmRequest): Promise<{ text: string; usage: LlmUsage }>;
  json<T>(req: LlmRequest & { schema: z.ZodType<T> }): Promise<{ data: T; usage: LlmUsage }>;
}
export type LlmSettings = { provider: AiProvider; model: string; apiKey?: string; baseUrl?: string | null };

const failed = (message: string) => new AppError(502, 'AI_FAILED', message);

/** Models on which Anthropic re-runs a declined request on a fallback model by itself. */
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
]);

function anthropic(s: LlmSettings): Llm {
  const client = new Anthropic({ apiKey: s.apiKey, maxRetries: 2, timeout: 180_000 });
  const base = (req: LlmRequest) => ({
    model: s.model,
    max_tokens: req.maxTokens ?? 16_000,
    system: req.system,
    messages: req.messages,
    ...(FALLBACK_MODELS.has(s.model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {}),
  });
  const usage = (u: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
  }) => ({
    inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens,
  });
  const check = (r: { stop_reason: string | null }) => {
    if (r.stop_reason === 'refusal') throw failed('The AI declined this request. Try different words.');
    if (r.stop_reason === 'max_tokens') throw failed('The answer was too long. Try a shorter request.');
  };
  const wrap = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Anthropic.AuthenticationError)
        throw failed('The AI key was not accepted. Check it in System Master → Integration → AI.');
      if (err instanceof Anthropic.PermissionDeniedError) throw failed('This AI key may not use that model.');
      if (err instanceof Anthropic.NotFoundError) throw failed(`The model "${s.model}" was not found.`);
      if (err instanceof Anthropic.RateLimitError)
        throw new AppError(429, 'RATE_LIMITED', 'The AI is busy. Try again in a minute.');
      if (err instanceof Anthropic.APIError)
        throw failed(`The AI service answered with an error (${err.status ?? 'no status'}).`);
      throw failed('Could not reach the AI service.');
    }
  };
  return {
    provider: 'anthropic',
    model: s.model,
    complete: (req) =>
      wrap(async () => {
        const r = await client.beta.messages.create({
          ...base(req),
          output_config: { effort: req.effort ?? 'low' },
        });
        check(r);
        const text = r.content
          .flatMap((b) => (b.type === 'text' ? [b.text] : []))
          .join('\n')
          .trim();
        return { text, usage: usage(r.usage) };
      }),
    json: (req) =>
      wrap(async () => {
        const r = await client.beta.messages.parse({
          ...base(req),
          output_config: { effort: req.effort ?? 'medium', format: betaZodOutputFormat(req.schema) },
        });
        check(r);
        if (!r.parsed_output) throw failed('The AI answer did not have the expected shape.');
        return { data: r.parsed_output as never, usage: usage(r.usage) };
      }),
  };
}

/** The answer as JSON: fenced or bare, checked against the schema. */
export function parseJson<T>(
  text: string,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; error: string } {
  const body = text.replace(/^[\s\S]*?```(?:json)?\s*([\s\S]*?)```[\s\S]*$/i, '$1').trim();
  const start = body.search(/[[{]/);
  let raw: unknown;
  try {
    raw = JSON.parse(start > 0 ? body.slice(start) : body);
  } catch {
    return { ok: false, error: 'The answer was not valid JSON.' };
  }
  const r = schema.safeParse(raw);
  return r.success
    ? { ok: true, data: r.data }
    : {
        ok: false,
        error: r.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      };
}

type Raw = (req: LlmRequest, schema?: object) => Promise<{ text: string; usage: LlmUsage }>;

/** For providers without schema-following output: ask once more with the problem if the JSON is off. */
function withJson(provider: AiProvider, model: string, raw: Raw): Llm {
  return {
    provider,
    model,
    complete: (req) => raw(req),
    async json(req) {
      const schema = z.toJSONSchema(req.schema, { target: 'draft-7', io: 'input' });
      const ask: LlmRequest = {
        ...req,
        system: `${req.system}\n\nReply with only one JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`,
      };
      const first = await raw(ask, schema);
      const one = parseJson(first.text, req.schema);
      if (one.ok) return { data: one.data, usage: first.usage };
      const second = await raw(
        {
          ...ask,
          messages: [
            ...ask.messages,
            { role: 'assistant', content: first.text },
            {
              role: 'user',
              content: `That did not match the schema (${one.error}). Send the corrected JSON only.`,
            },
          ],
        },
        schema,
      );
      const two = parseJson(second.text, req.schema);
      if (!two.ok) throw failed(`The AI answer did not have the expected shape: ${two.error}`);
      return {
        data: two.data,
        usage: {
          inputTokens: first.usage.inputTokens + second.usage.inputTokens,
          outputTokens: first.usage.outputTokens + second.usage.outputTokens,
        },
      };
    },
  };
}

async function post(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw failed('Could not reach the AI service.');
  }
  if (res.status === 401 || res.status === 403)
    throw failed('The AI key was not accepted. Check it in System Master → Integration → AI.');
  if (res.status === 429) throw new AppError(429, 'RATE_LIMITED', 'The AI is busy. Try again in a minute.');
  if (!res.ok) throw failed(`The AI service answered with an error (${res.status}).`);
  return (await res.json()) as Record<string, unknown>;
}

function openai(
  s: LlmSettings,
  provider: AiProvider = 'openai',
  defaultBase = 'https://api.openai.com/v1',
): Llm {
  const base = (s.baseUrl || defaultBase).replace(/\/$/, '');
  return withJson(provider, s.model, async (req, schema) => {
    const r = await post(
      `${base}/chat/completions`,
      {
        model: s.model,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        ...(schema ? { response_format: { type: 'json_object' } } : {}),
      },
      { authorization: `Bearer ${s.apiKey ?? ''}` },
      180_000,
    );
    const choice = (r.choices as { message?: { content?: string } }[] | undefined)?.[0];
    const u = (r.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
    return {
      text: choice?.message?.content ?? '',
      usage: { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 },
    };
  });
}

function gemini(s: LlmSettings): Llm {
  const base = (s.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  return withJson('gemini', s.model, async (req, schema) => {
    const r = await post(
      `${base}/models/${encodeURIComponent(s.model)}:generateContent`,
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        ...(schema ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
      },
      { 'x-goog-api-key': s.apiKey ?? '' },
      180_000,
    );
    const parts = (r.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined)?.[0]?.content
      ?.parts;
    const u = (r.usageMetadata ?? {}) as { promptTokenCount?: number; candidatesTokenCount?: number };
    return {
      text: (parts ?? []).map((p) => p.text ?? '').join(''),
      usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 },
    };
  });
}

/**
 * A model on the company's own machine. On a CPU an answer can take many minutes, so it is streamed:
 * without streaming nothing arrives until the end, and Node's fetch gives up after 5 minutes without headers.
 */
function ollama(s: LlmSettings): Llm {
  const base = (s.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  return withJson('ollama', s.model, async (req, schema) => {
    let res: Response;
    try {
      res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: s.model,
          stream: true,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
          ...(schema ? { format: schema } : {}),
          options: { num_ctx: 16_384 },
        }),
        signal: AbortSignal.timeout(30 * 60_000),
      });
    } catch {
      throw failed('Could not reach the AI service.');
    }
    if (!res.ok || !res.body) throw failed(`The AI service answered with an error (${res.status}).`);
    let text = '';
    const usage = { inputTokens: 0, outputTokens: 0 };
    let rest = '';
    const decoder = new TextDecoder();
    const take = (line: string) => {
      if (!line.trim()) return;
      const chunk = JSON.parse(line) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
        error?: string;
      };
      if (chunk.error) throw failed(`The AI service answered with an error: ${chunk.error}`);
      text += chunk.message?.content ?? '';
      if (chunk.prompt_eval_count) usage.inputTokens = chunk.prompt_eval_count;
      if (chunk.eval_count) usage.outputTokens = chunk.eval_count;
    };
    try {
      for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
        const lines = (rest + decoder.decode(part, { stream: true })).split('\n');
        rest = lines.pop() ?? '';
        lines.forEach(take);
      }
      take(rest);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw failed('The AI stopped answering half way.');
    }
    return { text, usage };
  });
}

export function makeLlm(s: LlmSettings): Llm {
  switch (s.provider) {
    case 'anthropic':
      return anthropic(s);
    case 'openai':
      return openai(s);
    case 'gemini':
      return gemini(s);
    case 'ollama':
      return ollama(s);
    case 'deepseek':
      // OpenAI-compatible, at DeepSeek's own address.
      return openai(s, 'deepseek', 'https://api.deepseek.com');
  }
}

/** Speech to text (Whisper-compatible, or Gemini listening to the clip). Hindi and English. */
export async function transcribeAudio(
  s: { provider: 'openai' | 'gemini'; apiKey: string; model?: string | null; baseUrl?: string | null },
  audio: Buffer,
  mime: string,
  lang: 'hi' | 'en',
): Promise<string> {
  if (s.provider === 'openai') {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: mime }),
      `speech.${mime.includes('ogg') ? 'ogg' : 'webm'}`,
    );
    form.append('model', s.model || 'whisper-1');
    form.append('language', lang);
    const base = (s.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw failed('Could not reach the speech-to-text service.');
    }
    if (!res.ok) throw failed(`Speech to text failed (${res.status}).`);
    return String(((await res.json()) as { text?: string }).text ?? '').trim();
  }
  const llm = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model || 'gemini-2.5-flash')}:generateContent`,
    {
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mime, data: audio.toString('base64') } },
            {
              text: `Write down exactly what is said, in ${lang === 'hi' ? 'Hindi (Devanagari)' : 'English'}. Only the words.`,
            },
          ],
        },
      ],
    },
    { 'x-goog-api-key': s.apiKey },
    120_000,
  );
  const parts = (llm.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined)?.[0]?.content
    ?.parts;
  return (parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}
