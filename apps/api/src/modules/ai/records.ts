import type { Db } from '@mono/db';
import { aiRecordTypeSchema, checkRecordDefinition, toRecordType, type RecordTypeDraft } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { runAi } from './llm';
import { companyContext } from './prompts/context';
import * as RECORD from './prompts/record-type.v1';

/** What is wrong with a draft, in words: the definition's own checks, plus the name and prefix. */
function problemsOf(d: RecordTypeDraft): string[] {
  const out = checkRecordDefinition(d.definition);
  if (!d.name) out.unshift('Give the record type a name');
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(d.prefix)) out.unshift('The prefix must be 2 to 5 capital letters');
  if (!d.definition.fields.length) out.push('Add at least one field');
  if (d.definition.statuses.length < 2)
    out.push('Give at least two statuses (where it starts, where it ends)');
  return out;
}

/**
 * "Build a record type with AI" (plan §2.6, row U8). The model proposes; MONO turns it into a definition and
 * checks it. Problems MONO can name go back to the model once, and the version with fewer problems is kept
 * (decision 59). Nothing is saved: the draft opens in the type editor for a person to change and save.
 */
export async function draftRecordType(db: Db, actor: Actor, appSecret: string, text: string) {
  if (!can(actor, 'records.admin')) throw new AppError(403, 'FORBIDDEN', "You can't set up record types");
  const caller = { companyId: actor.companyId, userId: actor.userId, appSecret };
  const ctx = await companyContext(db, actor.companyId);
  const ask = async (messages: { role: 'user' | 'assistant'; content: string }[]) => {
    const r = await runAi(db, caller, 'record_type', RECORD.id, (llm) =>
      llm.json({
        system: RECORD.system(ctx),
        messages,
        schema: aiRecordTypeSchema,
        effort: 'low',
        maxTokens: 8_000,
      }),
    );
    return { raw: r.data, draft: toRecordType(r.data) };
  };
  const first = await ask([{ role: 'user', content: RECORD.user(text) }]);
  let best = { draft: first.draft, problems: problemsOf(first.draft) };
  if (best.problems.length) {
    const again = await ask([
      { role: 'user', content: RECORD.user(text) },
      { role: 'assistant', content: JSON.stringify(first.raw) },
      { role: 'user', content: RECORD.fix(best.problems) },
    ]);
    const problems = problemsOf(again.draft);
    if (problems.length < best.problems.length) best = { draft: again.draft, problems };
  }
  return { ...best.draft, problems: best.problems };
}
