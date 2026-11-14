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
  // The company's own Whisper server needs no key; the others do.
  const own = provider === 'whisper' && Boolean(cfg?.sttBaseUrl);
  const key = secrets.sttKey || (cfg?.provider === provider ? secrets.apiKey : undefined);
  if (!cfg || !(own || ((provider === 'openai' || provider === 'gemini') && key)))
    throw new AppError(409, 'AI_NOT_CONNECTED', 'Speech to text is not set up');
  const started = Date.now();
  const text = await transcribeAudio(
    own
      ? { provider: 'openai', apiKey: key ?? '', model: cfg.sttModel || 'whisper-1', baseUrl: cfg.sttBaseUrl }
      : {
          provider: provider as 'openai' | 'gemini',
          apiKey: key!,
          model: cfg.sttModel,
          baseUrl: provider === cfg.provider ? cfg.baseUrl : null,
        },
    audio,
    mime,
    lang,
  );
  await db.aiUsage.create({
    data: {
      companyId: who.companyId,
      userId: who.userId,
      feature: 'transcribe',
      provider: provider!,
      model: cfg.sttModel || (provider === 'gemini' ? 'gemini-2.5-flash' : 'whisper-1'),
      ms: Date.now() - started,
    },
  });
  return text;
}
