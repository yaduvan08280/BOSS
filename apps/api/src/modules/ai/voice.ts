import type { Db } from '@mono/db';
import { AppError } from '../../lib/errors';
import { decryptJson } from '../../lib/secrets';
import type { AiSecrets } from './llm';
import { transcribeAudio } from './providers';

/** Tests swap the speech service for a scripted one; nothing else uses this. */
let testStt: ((audio: Buffer, lang: 'hi' | 'en') => string) | null = null;
export function setTestStt(fn: typeof testStt) {
  testStt = fn;
}

/**
 * A recording → text, through the speech service the company chose (decision 61), logged in `ai_usage`.
 * Refuses with AI_NOT_CONNECTED when none is set up.
 */
export async function transcribeFor(
  db: Db,
  who: { companyId: string; userId: string },
  appSecret: string,
  audio: Buffer,
  mime: string,
  lang: 'hi' | 'en',
): Promise<string> {
  if (testStt) return testStt(audio, lang);
  const cfg = await db.aiConfig.findUnique({ where: { companyId: who.companyId } });
  const secrets = decryptJson<AiSecrets>(cfg?.secret, appSecret) ?? {};
  const provider = cfg?.sttProvider;
  const key = secrets.sttKey || (cfg?.provider === provider ? secrets.apiKey : undefined);
  if (!cfg || (provider !== 'openai' && provider !== 'gemini') || !key)
    throw new AppError(409, 'AI_NOT_CONNECTED', 'Speech to text is not set up');
  const started = Date.now();
  const text = await transcribeAudio(
    { provider, apiKey: key, model: cfg.sttModel, baseUrl: provider === cfg.provider ? cfg.baseUrl : null },
    audio,
    mime,
    lang,
  );
  await db.aiUsage.create({
    data: {
      companyId: who.companyId,
      userId: who.userId,
      feature: 'transcribe',
      provider,
      model: cfg.sttModel || (provider === 'openai' ? 'whisper-1' : 'gemini-2.5-flash'),
      ms: Date.now() - started,
    },
  });
  return text;
}
