import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { aiConfigInputSchema, aiFlowDraftSchema, localDate, zonedToUtc } from '@mono/shared';
import type { Env } from '../../env';
import { AppError } from '../../lib/errors';
import { actorOf } from '../delegation/routes';
import { can } from '../work/actor';
import { askQuestion } from './ask';
import { chatGptPrompt, readBusinessDetails, refreshBusinessDetails, saveBusinessDetails } from './business';
import { aiStatus, aiUsageReport, readAiConfig, saveAiConfig, testAiConfig } from './config';
import { createFromDraft, draftFlow, draftMaster, editFlowWithAi, rememberFacts, suggestKpis } from './flows';
import { deleteMaster, listMasters, masterDefSchema, saveMaster } from './masters';
import { draftRecordType } from './records';
import { transcribeFor } from './voice';

const idParam = z.object({ id: z.string() });
/** AI calls cost money: a person gets a sensible number per minute. */
const perMinute = (max: number) => ({
  rateLimit: { max, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => r.auth?.userId ?? r.ip },
});

/** CLAUDE.md §13: AI settings, business details, Build/Edit with AI, KPI and master drafts, Ask, Dictate. */
export async function aiRoutes(app: FastifyInstance, opts: { env: Env }) {
  const secret = opts.env.APP_SECRET;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['ai'];
  // A fresh hook list per route: the rate limiter adds its hook to the list, so a shared one would leak limits.
  const signedIn = () => ({ onRequest: [app.authenticate] });
  const admin = () => ({ onRequest: [app.requirePermission('ai.admin')] });
  const viewer = () => ({ onRequest: [app.requirePermission('ai.view')] });
  const fms = () => ({ onRequest: [app.requirePermission('fms.edit')] });

  r.get('/api/ai/status', { ...signedIn(), schema: { tags } }, async (q) =>
    aiStatus(app.prisma, q.auth!.companyId, secret),
  );

  r.get('/api/ai/config', { ...admin(), schema: { tags } }, async (q) =>
    readAiConfig(app.prisma, q.auth!.companyId, secret),
  );
  r.put('/api/ai/config', { ...admin(), schema: { tags, body: aiConfigInputSchema } }, async (q) => {
    await saveAiConfig(app.prisma, actorOf(q), q.body, secret);
    return readAiConfig(app.prisma, q.auth!.companyId, secret);
  });
  r.post('/api/ai/config/test', { ...admin(), config: perMinute(6), schema: { tags } }, async (q) =>
    testAiConfig(app.prisma, actorOf(q), secret),
  );
  r.get('/api/ai/usage', { ...admin(), schema: { tags } }, async (q) => {
    const company = await app.prisma.company.findUniqueOrThrow({
      where: { id: q.auth!.companyId },
      select: { timezone: true },
    });
    const today = localDate(new Date(), company.timezone);
    return aiUsageReport(
      app.prisma,
      q.auth!.companyId,
      zonedToUtc(`${today.slice(0, 7)}-01`, 0, company.timezone),
    );
  });

  r.get('/api/ai/business-details', { ...admin(), schema: { tags } }, async (q) =>
    readBusinessDetails(app.prisma, q.auth!.companyId),
  );
  r.put(
    '/api/ai/business-details',
    { ...admin(), schema: { tags, body: z.object({ text: z.string().max(20_000) }) } },
    async (q) => saveBusinessDetails(app.prisma, actorOf(q), q.body.text),
  );
  r.post(
    '/api/ai/business-details/refresh',
    { ...admin(), config: perMinute(4), schema: { tags } },
    async (q) => refreshBusinessDetails(app.prisma, actorOf(q), secret),
  );
  r.get('/api/ai/business-details/chatgpt-prompt', { ...admin(), schema: { tags } }, async (q) =>
    chatGptPrompt(app.prisma, q.auth!.companyId),
  );
  r.post(
    '/api/ai/remember',
    {
      ...signedIn(),
      schema: { tags, body: z.object({ lines: z.array(z.string().trim().min(3).max(300)).min(1).max(10) }) },
    },
    async (q) => {
      const actor = actorOf(q);
      if (!can(actor, 'fms.edit') && !can(actor, 'ai.admin'))
        throw new AppError(403, 'FORBIDDEN', "You can't change the business details");
      return rememberFacts(app.prisma, actor, q.body.lines);
    },
  );

  r.post(
    '/api/ai/flows/draft',
    {
      ...fms(),
      config: perMinute(8),
      schema: {
        tags,
        body: z.object({
          text: z.string().trim().min(10, 'Tell a little more about how the work goes').max(8_000),
          name: z.string().trim().max(100).nullish(),
          departmentId: z.string().nullish(),
          previous: aiFlowDraftSchema.nullish(),
          changes: z.string().trim().max(2_000).nullish(),
        }),
      },
    },
    async (q) => draftFlow(app.prisma, actorOf(q), secret, q.body),
  );
  r.post(
    '/api/ai/flows/create',
    { ...fms(), schema: { tags, body: z.object({ draft: aiFlowDraftSchema, text: z.string().max(8_000) }) } },
    async (q) => createFromDraft(app.prisma, actorOf(q), q.body.draft, q.body.text),
  );
  r.post(
    '/api/ai/flows/:id/edit',
    {
      ...fms(),
      config: perMinute(8),
      schema: { tags, params: idParam, body: z.object({ instruction: z.string().trim().min(5).max(2_000) }) },
    },
    async (q) => editFlowWithAi(app.prisma, actorOf(q), secret, q.params.id, q.body.instruction),
  );
  r.post(
    '/api/ai/flows/:id/kpis',
    { ...fms(), config: perMinute(8), schema: { tags, params: idParam } },
    async (q) => suggestKpis(app.prisma, actorOf(q), secret, q.params.id),
  );

  const masters = () => ({ onRequest: [app.requirePermission('core.edit')] });
  r.get('/api/masters', { ...signedIn(), schema: { tags: ['masters'] } }, async (q) =>
    listMasters(app.prisma, q.auth!.companyId),
  );
  r.post('/api/masters', { ...masters(), schema: { tags: ['masters'], body: masterDefSchema } }, async (q) =>
    saveMaster(app.prisma, actorOf(q), q.body),
  );
  r.put(
    '/api/masters/:id',
    { ...masters(), schema: { tags: ['masters'], params: idParam, body: masterDefSchema } },
    async (q) => saveMaster(app.prisma, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/masters/:id', { ...masters(), schema: { tags: ['masters'], params: idParam } }, async (q) =>
    deleteMaster(app.prisma, actorOf(q), q.params.id),
  );
  r.post(
    '/api/ai/masters/draft',
    {
      ...masters(),
      config: perMinute(8),
      schema: { tags, body: z.object({ text: z.string().trim().min(5).max(4_000) }) },
    },
    async (q) => draftMaster(app.prisma, actorOf(q), secret, q.body.text),
  );

  // "Build a record type with AI": a draft for the type editor — nothing is saved here.
  r.post(
    '/api/ai/record-types/draft',
    {
      ...signedIn(),
      config: perMinute(8),
      schema: { tags, body: z.object({ text: z.string().trim().min(10).max(4_000) }) },
    },
    async (q) => draftRecordType(app.prisma, actorOf(q), secret, q.body.text),
  );

  r.post(
    '/api/ai/ask',
    {
      ...viewer(),
      config: perMinute(15),
      schema: { tags, body: z.object({ question: z.string().trim().min(3).max(500) }) },
    },
    async (q) => askQuestion(app.prisma, actorOf(q), secret, q.body.question),
  );

  // Dictate: a short recording → text, through the provider chosen for speech (Hindi or English).
  await app.register(async (sub) => {
    await sub.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    sub.post(
      '/api/ai/transcribe',
      { onRequest: [app.authenticate], config: perMinute(20), schema: { tags } },
      async (q) => {
        const file = await q.file();
        if (!file) throw new AppError(400, 'BAD_REQUEST', 'Send a recording');
        if (!/^audio\//.test(file.mimetype))
          throw new AppError(400, 'BAD_REQUEST', 'That is not a recording');
        const audio = await file.toBuffer();
        const lang = (q.query as { lang?: string }).lang === 'hi' ? 'hi' : 'en';
        const text = await transcribeFor(
          app.prisma,
          { companyId: q.auth!.companyId, userId: q.auth!.userId },
          secret,
          audio,
          file.mimetype,
          lang,
        ).catch((err) => {
          // The screen falls back to the browser's own speech recognition on this answer.
          if (err instanceof AppError && err.code === 'AI_NOT_CONNECTED')
            throw new AppError(
              409,
              'AI_NOT_CONNECTED',
              'Speech to text is not set up; the browser does it instead',
            );
          throw err;
        });
        return { text };
      },
    );
  });
}
