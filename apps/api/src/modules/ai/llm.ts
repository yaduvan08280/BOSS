import type { Db, Tx } from '@mono/db';
import { costMicros, type AiProvider } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { decryptJson } from '../../lib/secrets';
import { makeLlm, type Llm, type LlmUsage } from './providers';

export type AiSecrets = { apiKey?: string; sttKey?: string };
export type AiCaller = { companyId: string; userId: string | null; appSecret: string };

/** Tests swap the provider for a scripted one; nothing else uses this. */
let testLlm: ((companyId: string) => Llm | null) | null = null;
export function setTestLlm(fn: typeof testLlm) {
  testLlm = fn;
}

export async function aiConfigOf(db: Db | Tx, companyId: string) {
  return db.aiConfig.findUnique({ where: { companyId } });
}

/** The company's AI, or a clear "connect AI first" (CLAUDE.md §13). */
export async function llmFor(
  db: Db | Tx,
  c: AiCaller,
): Promise<{ llm: Llm; prices: { in: number | null; out: number | null } }> {
  const fake = testLlm?.(c.companyId);
  if (fake) return { llm: fake, prices: { in: null, out: null } };
  const cfg = await aiConfigOf(db, c.companyId);
  if (!cfg) throw new AppError(409, 'AI_NOT_CONNECTED', 'Connect AI in System Master → Integration → AI');
  const secrets = decryptJson<AiSecrets>(cfg.secret, c.appSecret) ?? {};
  if (cfg.provider !== 'ollama' && !secrets.apiKey)
    throw new AppError(409, 'AI_NOT_CONNECTED', 'Add the AI key in System Master → Integration → AI');
  return {
    llm: makeLlm({
      provider: cfg.provider as AiProvider,
      model: cfg.model,
      apiKey: secrets.apiKey,
      baseUrl: cfg.baseUrl,
    }),
    prices: {
      in: cfg.priceIn === null ? null : Number(cfg.priceIn),
      out: cfg.priceOut === null ? null : Number(cfg.priceOut),
    },
  };
}

/** Run one AI call and log it in ai_usage with tokens, time and the estimated cost (also when it fails). */
export async function runAi<T>(
  db: Db,
  c: AiCaller,
  feature: string,
  prompt: string,
  call: (llm: Llm) => Promise<{ usage: LlmUsage } & T>,
): Promise<T> {
  const { llm, prices } = await llmFor(db, c);
  const started = Date.now();
  const log = (ok: boolean, usage: LlmUsage, error?: string) =>
    db.aiUsage
      .create({
        data: {
          companyId: c.companyId,
          userId: c.userId,
          feature,
          provider: llm.provider,
          model: llm.model,
          prompt,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costMicros: costMicros(llm.provider, llm.model, usage.inputTokens, usage.outputTokens, prices),
          ms: Date.now() - started,
          ok,
          error: error?.slice(0, 500) ?? null,
        },
      })
      .catch(() => undefined);
  try {
    const out = await call(llm);
    await log(true, out.usage);
    return out;
  } catch (err) {
    await log(false, { inputTokens: 0, outputTokens: 0 }, (err as Error).message);
    throw err;
  }
}
