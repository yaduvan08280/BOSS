import { z } from 'zod';

/** CLAUDE.md §13: one interface, four providers. The company picks one in System Master → Integration → AI. */
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama', 'deepseek'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const STT_PROVIDERS = ['browser', 'openai', 'gemini'] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];

/** Models MONO knows the price of (USD per million tokens). Others use the prices typed in settings. */
export const KNOWN_MODELS: Record<AiProvider, { id: string; label: string; in: number; out: number }[]> = {
  anthropic: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', in: 4, out: 20 },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', in: 2, out: 10 },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', in: 0.1, out: 0.5 },
  ],
  openai: [],
  gemini: [],
  ollama: [],
  // Peak-hour prices (weekdays 06:30–09:30 and 11:30–15:30 IST); off-peak is half, so estimates err high.
  deepseek: [
    { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', in: 0.3, out: 1.2 },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', in: 1.32, out: 3.96 },
  ],
};

/** The model a new connection starts with (only Anthropic has one; the others are typed in). */
export const DEFAULT_MODEL: Partial<Record<AiProvider, string>> = {
  anthropic: 'claude-opus-5-5',
  deepseek: 'deepseek-flash',
};

/** Estimated cost in millionths of a dollar. Local models (Ollama) cost nothing. */
export function costMicros(
  provider: AiProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  override?: { in?: number | null; out?: number | null },
): number {
  if (provider === 'ollama') return 0;
  const known = KNOWN_MODELS[provider].find((m) => m.id === model);
  const pin = override?.in ?? known?.in;
  const pout = override?.out ?? known?.out;
  if (pin === undefined || pout === undefined) return 0;
  return Math.round(inputTokens * pin + outputTokens * pout);
}

export const aiConfigInputSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1, 'Name the model').max(100),
    /** Only sent when changed; never sent back to the browser. */
    apiKey: z.string().trim().max(400).optional(),
    baseUrl: z.url().nullish().or(z.literal('')),
    priceIn: z.number().min(0).max(1000).nullish(),
    priceOut: z.number().min(0).max(1000).nullish(),
    sttProvider: z.enum(STT_PROVIDERS).default('browser'),
    sttModel: z.string().trim().max(100).nullish(),
    sttKey: z.string().trim().max(400).optional(),
    dailySummary: z.boolean().default(true),
  })
  .refine((c) => c.provider !== 'ollama' || Boolean(c.baseUrl), {
    message: 'Ollama needs the address it runs on, e.g. http://localhost:11434',
    path: ['baseUrl'],
  })
  // Without an address an OpenAI-compatible key goes to OpenAI itself and is refused there.
  .refine((c) => c.provider !== 'openai' || !/^deepseek/i.test(c.model) || Boolean(c.baseUrl), {
    message: 'For DeepSeek, choose DeepSeek above (or set the server address https://api.deepseek.com)',
    path: ['baseUrl'],
  });
export type AiConfigInput = z.infer<typeof aiConfigInputSchema>;

/** Business details: how much the AI has to go on. */
export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
export type DetailsQuality = 'empty' | 'short' | 'fair' | 'good' | 'veryGood';
export function detailsQuality(words: number): DetailsQuality {
  if (words === 0) return 'empty';
  if (words < 80) return 'short';
  if (words < 200) return 'fair';
  if (words < 400) return 'good';
  return 'veryGood';
}
