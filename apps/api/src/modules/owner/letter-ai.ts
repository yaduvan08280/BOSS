import type { Db } from '@mono/db';
import { runAi } from '../ai/llm';
import * as LETTER from '../ai/prompts/owner-letter.v1';

type Line = { key: string; now: string; before: string };
export type LetterFacts = {
  company: string;
  week: { from: string; to: string };
  better: Line[];
  worse: Line[];
  decision: { kind: string; text: string; since: string | null } | null;
};

const WORDS: Record<'en' | 'hi', Record<string, string>> = {
  en: {
    sales: 'Sales',
    attendance: 'Attendance',
    kept: 'Promises kept',
    lateWork: 'Late work',
    missed: 'Checklists missed',
    leaks: 'Unexplained money',
    better: 'Better',
    worse: 'Worse',
    waiting: 'Waiting on you',
    slip: 'a help slip',
    leave: 'a leave request',
    stock: 'stock adjustments',
  },
  hi: {
    sales: 'बिक्री',
    attendance: 'उपस्थिति',
    kept: 'निभाए गए वादे',
    lateWork: 'देर से हुआ काम',
    missed: 'छूटी चेकलिस्ट',
    leaks: 'बिना हिसाब का पैसा',
    better: 'बेहतर',
    worse: 'ख़राब',
    waiting: 'आपके फ़ैसले का इंतज़ार',
    slip: 'एक हेल्प स्लिप',
    leave: 'एक छुट्टी का अनुरोध',
    stock: 'स्टॉक समायोजन',
  },
};
const dmy = (d: string) => d.split('-').reverse().join('/');

/** The week's figures as plain lines — what the AI writes from, and what is sent when there is no AI. */
export function letterFacts(l: LetterFacts, lang: 'en' | 'hi' = 'en'): string {
  const w = WORDS[lang];
  const list = (rows: Line[]) =>
    rows.map((r) => `${w[r.key] ?? r.key} ${r.before} → ${r.now}`).join('; ') || '—';
  const decision = l.decision
    ? `${w[l.decision.kind] ?? l.decision.kind}${l.decision.text ? `: ${l.decision.text}` : ''}${
        l.decision.since ? ` (${dmy(l.decision.since)})` : ''
      }`
    : '—';
  return `${w.better}: ${list(l.better)}.\n${w.worse}: ${list(l.worse)}.\n${w.waiting}: ${decision}.`;
}

/**
 * The letter in words, written by the company's AI from the figures and kept for the week (one call a week per
 * language). Null when AI is not connected or did not answer — the figures are shown instead.
 */
export async function writtenLetter(
  db: Db,
  companyId: string,
  appSecret: string,
  l: LetterFacts,
  lang: 'en' | 'hi',
): Promise<string | null> {
  if (!l.better.length && !l.worse.length && !l.decision) return null;
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { settings: true },
  });
  const settings = (company.settings ?? {}) as Record<string, unknown>;
  const kept = settings.ownerLetterText as { week?: string; lang?: string; text?: string } | undefined;
  if (kept?.week === l.week.from && kept.lang === lang && kept.text) return kept.text;
  try {
    const details = await db.businessDetails.findUnique({ where: { companyId }, select: { text: true } });
    const { text } = await runAi(
      db,
      { companyId, userId: null, appSecret },
      'owner_letter',
      LETTER.id,
      (llm) =>
        llm.complete({
          system: LETTER.system(l.company, details?.text.trim() ?? '', lang),
          messages: [{ role: 'user', content: LETTER.user(letterFacts(l, 'en')) }],
          effort: 'low',
          maxTokens: 1_500,
        }),
    );
    const written = text.trim();
    if (written.length < 40) return null;
    const fresh = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { settings: true },
    });
    await db.company.update({
      where: { id: companyId },
      data: {
        settings: {
          ...((fresh.settings ?? {}) as Record<string, unknown>),
          ownerLetterText: { week: l.week.from, lang, text: written },
        },
      },
    });
    return written;
  } catch {
    return null;
  }
}
