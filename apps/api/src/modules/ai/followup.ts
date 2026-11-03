import type { Db } from '@mono/db';
import { runAi } from './llm';
import * as FOLLOW_UP from './prompts/follow-up.v1';

/**
 * "AI follow-up" rules (CLAUDE.md §7.2): the AI writes the chase message for one person from what happened
 * and the usual template. Null when AI isn't connected or fails — the template is sent instead.
 */
export async function aiFollowUpText(
  db: Db,
  appSecret: string,
  companyId: string,
  input: { recipient: string; lang: 'en' | 'hi'; facts: string; template: string },
): Promise<string | null> {
  try {
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } });
    const r = await runAi(db, { companyId, userId: null, appSecret }, 'follow_up', FOLLOW_UP.id, (llm) =>
      llm.complete({
        system: FOLLOW_UP.system(company.name, input.lang),
        messages: [{ role: 'user', content: FOLLOW_UP.user(input.recipient, input.facts, input.template) }],
        effort: 'low',
        maxTokens: 2_000,
      }),
    );
    return r.text.trim().slice(0, 1500) || null;
  } catch {
    return null;
  }
}
