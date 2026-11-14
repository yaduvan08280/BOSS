import type { Db } from '@mono/db';
import { KNOWN_MODELS, type AiConfigInput, type AiProvider } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { decryptJson, encryptJson } from '../../lib/secrets';
import type { Actor } from '../work/actor';
import { llmFor, runAi, type AiSecrets } from './llm';

/** Settings as the browser sees them: never the key itself, only whether one is saved. */
export async function readAiConfig(db: Db, companyId: string, appSecret: string) {
  const cfg = await db.aiConfig.findUnique({ where: { companyId } });
  if (!cfg) return null;
  const secrets = decryptJson<AiSecrets>(cfg.secret, appSecret) ?? {};
  return {
    provider: cfg.provider as AiProvider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    priceIn: cfg.priceIn === null ? null : Number(cfg.priceIn),
    priceOut: cfg.priceOut === null ? null : Number(cfg.priceOut),
    sttProvider: cfg.sttProvider,
    sttModel: cfg.sttModel,
    sttBaseUrl: cfg.sttBaseUrl,
    dailySummary: cfg.dailySummary,
    hasKey: Boolean(secrets.apiKey),
    keyEnd: secrets.apiKey ? secrets.apiKey.slice(-4) : null,
    hasSttKey: Boolean(secrets.sttKey),
    lastTestAt: cfg.lastTestAt,
    lastTestOk: cfg.lastTestOk,
    lastTestError: cfg.lastTestError,
    knownPrice: KNOWN_MODELS[cfg.provider as AiProvider]?.some((m) => m.id === cfg.model) ?? false,
  };
}

/** Save; a key left empty keeps the stored one. Changing provider forgets the old key. */
export async function saveAiConfig(db: Db, actor: Actor, input: AiConfigInput, appSecret: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.aiConfig.findUnique({ where: { companyId: actor.companyId } });
    const old = decryptJson<AiSecrets>(before?.secret, appSecret) ?? {};
    const sameProvider = before?.provider === input.provider;
    const secrets: AiSecrets = {
      apiKey: input.apiKey || (sameProvider ? old.apiKey : undefined),
      sttKey: input.sttKey || old.sttKey,
    };
    const data = {
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl || null,
      priceIn: input.priceIn ?? null,
      priceOut: input.priceOut ?? null,
      sttProvider: input.sttProvider,
      sttModel: input.sttModel || null,
      sttBaseUrl: input.sttProvider === 'whisper' ? input.sttBaseUrl || null : null,
      dailySummary: input.dailySummary,
      secret: encryptJson(secrets, appSecret),
      updatedById: actor.userId,
      // A different connection has not been tested yet.
      ...(before && (before.provider !== input.provider || before.model !== input.model || input.apiKey)
        ? { lastTestAt: null, lastTestOk: null, lastTestError: null }
        : {}),
    };
    await tx.aiConfig.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, ...data },
      update: data,
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: 'ai.config_saved',
        entityType: 'ai_config',
        entityId: actor.companyId,
        // Never the key: only which provider and model.
        before: before ? { provider: before.provider, model: before.model } : null,
        after: { provider: input.provider, model: input.model, keyChanged: Boolean(input.apiKey) },
      },
    );
  });
}

/** "Test" button: one tiny call; the result is kept so the screen can show it. */
export async function testAiConfig(db: Db, actor: Actor, appSecret: string) {
  const caller = { companyId: actor.companyId, userId: actor.userId, appSecret };
  let ok = false;
  let error: string | null = null;
  let reply = '';
  try {
    const r = await runAi(db, caller, 'test', 'test@1', (llm) =>
      llm.complete({
        system: 'You check that a connection works.',
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        effort: 'low',
        maxTokens: 2000,
      }),
    );
    reply = r.text.slice(0, 100);
    ok = true;
  } catch (err) {
    error = (err as Error).message;
  }
  await db.aiConfig.updateMany({
    where: { companyId: actor.companyId },
    data: { lastTestAt: new Date(), lastTestOk: ok, lastTestError: error },
  });
  return { ok, error, reply };
}

/** For buttons across the app: is AI there, and who turns speech into text. */
export async function aiStatus(db: Db, companyId: string, appSecret: string) {
  const cfg = await db.aiConfig.findUnique({ where: { companyId } });
  if (!cfg) return { connected: false, provider: null, model: null, stt: 'browser' as const };
  let connected = true;
  try {
    await llmFor(db, { companyId, userId: null, appSecret });
  } catch {
    connected = false;
  }
  const secrets = decryptJson<AiSecrets>(cfg.secret, appSecret) ?? {};
  const sttKey = secrets.sttKey || (cfg.provider === cfg.sttProvider ? secrets.apiKey : undefined);
  return {
    connected,
    provider: cfg.provider,
    model: cfg.model,
    stt:
      cfg.sttProvider === 'whisper' && cfg.sttBaseUrl
        ? 'whisper'
        : cfg.sttProvider !== 'browser' && sttKey
          ? cfg.sttProvider
          : 'browser',
  };
}

/** This month's calls, tokens and estimated cost, by feature, plus the latest calls. */
export async function aiUsageReport(db: Db, companyId: string, monthStart: Date) {
  const [byFeature, recent] = await Promise.all([
    db.aiUsage.groupBy({
      by: ['feature'],
      where: { companyId, createdAt: { gte: monthStart } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
    }),
    db.aiUsage.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        feature: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        costMicros: true,
        ms: true,
        ok: true,
        error: true,
        userId: true,
        createdAt: true,
      },
    }),
  ]);
  const rows = byFeature.map((f) => ({
    feature: f.feature,
    calls: f._count,
    inputTokens: f._sum.inputTokens ?? 0,
    outputTokens: f._sum.outputTokens ?? 0,
    costMicros: f._sum.costMicros ?? 0,
  }));
  return {
    month: rows,
    total: rows.reduce(
      (t, r) => ({
        calls: t.calls + r.calls,
        inputTokens: t.inputTokens + r.inputTokens,
        outputTokens: t.outputTokens + r.outputTokens,
        costMicros: t.costMicros + r.costMicros,
      }),
      { calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 },
    ),
    recent,
  };
}
