import type { Db } from '@mono/db';
import { aiBusinessSchema, detailsQuality, flowDefinitionSchema, wordCount } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import type { Actor } from '../work/actor';
import { runAi } from './llm';
import * as BUSINESS from './prompts/business.v1';

export async function readBusinessDetails(db: Db, companyId: string) {
  const row = await db.businessDetails.findUnique({ where: { companyId } });
  const text = row?.text ?? '';
  const words = wordCount(text);
  return {
    text,
    words,
    quality: detailsQuality(words),
    updatedAt: row?.updatedAt ?? null,
    updatedById: row?.updatedById ?? null,
  };
}

export async function saveBusinessDetails(db: Db, actor: Actor, text: string) {
  await db.$transaction(async (tx) => {
    const before = await tx.businessDetails.findUnique({ where: { companyId: actor.companyId } });
    await tx.businessDetails.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, text, updatedById: actor.userId },
      update: { text, updatedById: actor.userId },
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: 'ai.business_details_saved',
        entityType: 'business_details',
        entityId: actor.companyId,
        before: { words: wordCount(before?.text ?? '') },
        after: { words: wordCount(text) },
      },
    );
  });
  return readBusinessDetails(db, actor.companyId);
}

/** What MONO's own data says about the company, in plain lines (no personal details beyond names and roles). */
export async function businessFacts(db: Db, companyId: string): Promise<string> {
  const [company, branches, departments, flows, docTypes, checklists, tasks] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId } }),
    db.branch.findMany({ where: { companyId, deletedAt: null }, select: { name: true, city: true } }),
    db.department.findMany({
      where: { companyId, deletedAt: null },
      select: {
        name: true,
        hod: { select: { name: true } },
        _count: { select: { mainMembers: { where: { deletedAt: null, status: 'ACTIVE' } } } },
      },
    }),
    db.flow.findMany({
      where: { companyId, deletedAt: null, status: { not: 'ARCHIVED' } },
      select: { name: true, runName: true, draft: true },
    }),
    db.documentType.findMany({ where: { companyId, deletedAt: null }, select: { name: true } }),
    db.checklistMaster.findMany({
      where: { companyId, deletedAt: null, active: true },
      select: { name: true },
      take: 30,
    }),
    db.task.count({
      where: { companyId, deletedAt: null, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
  ]);
  const lines = [
    `Company: ${company.legalName || company.name}${company.city ? `, ${company.city}` : ''}${company.state ? `, ${company.state}` : ''}.`,
    branches.length
      ? `Branches: ${branches.map((b) => [b.name, b.city].filter(Boolean).join(' – ')).join('; ')}.`
      : '',
    departments.length
      ? `Departments: ${departments
          .map((d) => `${d.name} (${d._count.mainMembers} people${d.hod ? `, head ${d.hod.name}` : ''})`)
          .join('; ')}.`
      : '',
    ...flows.map((f) => {
      const def = flowDefinitionSchema.safeParse(f.draft);
      const steps = def.success ? def.data.steps.map((s) => s.name).join(' → ') : '';
      return `Process "${f.name}" (each run is a ${f.runName})${steps ? `: ${steps}` : ''}.`;
    }),
    docTypes.length ? `Papers made: ${docTypes.map((d) => d.name).join(', ')}.` : '',
    checklists.length ? `Recurring checklists: ${checklists.map((c) => c.name).join(', ')}.` : '',
    `Tasks given in the last 30 days: ${tasks}.`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** "Refresh with our AI": a better text from the current one plus the data. Shown for review, not saved. */
export async function refreshBusinessDetails(db: Db, actor: Actor, appSecret: string) {
  const current = (await readBusinessDetails(db, actor.companyId)).text;
  const facts = await businessFacts(db, actor.companyId);
  const r = await runAi(
    db,
    { companyId: actor.companyId, userId: actor.userId, appSecret },
    'business',
    BUSINESS.id,
    (llm) =>
      llm.json({
        system: BUSINESS.system,
        messages: [{ role: 'user', content: BUSINESS.user(current, facts) }],
        schema: aiBusinessSchema,
        effort: 'medium',
        maxTokens: 8_000,
      }),
  );
  const words = wordCount(r.data.text);
  return { text: r.data.text, words, quality: detailsQuality(words) };
}

/** "Update it with ChatGPT": the prompt to copy (no AI call, nothing leaves MONO by itself). */
export async function chatGptPrompt(db: Db, companyId: string) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } });
  const current = (await readBusinessDetails(db, companyId)).text;
  return { prompt: BUSINESS.chatGptPrompt(company.name, current, await businessFacts(db, companyId)) };
}
