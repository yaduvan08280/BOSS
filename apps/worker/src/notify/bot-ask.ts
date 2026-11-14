import type { Db } from '@mono/db';
import { actorFor, askQuestion, transcribeFor } from '@mono/api/services';

type Me = { id: string; name: string; companyId: string; lang: string | null };
const codeOf = (err: unknown) => (err as { code?: string } | null)?.code;

/** A question about the company's data, answered through Ask with the asker's own rights (decision 60). */
export async function askReply(db: Db, me: Me, appSecret: string, question: string): Promise<string> {
  const q = question.trim();
  if (q.length < 3) return 'Ask a question after /ask — for example: /ask how many tasks are overdue?';
  const actor = await actorFor(db, me.companyId, me.id);
  if (!actor) return 'Link your Telegram first.';
  try {
    const res = await askQuestion(db, actor, appSecret, q.slice(0, 500));
    const lines = [res.answer.trim()];
    // A short table reads well in a chat; a long one belongs in the app.
    const rows = res.rows.slice(0, 8);
    if (rows.length > 1 && res.columns.length)
      for (const r of rows)
        lines.push(
          `• ${res.columns
            .filter((c) => c !== 'link')
            .map((c) => String((r as Record<string, unknown>)[c] ?? '—'))
            .join(' · ')}`.slice(0, 300),
        );
    if (res.total > rows.length && rows.length > 1)
      lines.push(`… and ${res.total - rows.length} more in the app.`);
    return lines.join('\n').slice(0, 3_900);
  } catch (err) {
    if (codeOf(err) === 'AI_NOT_CONNECTED')
      return 'AI is not connected yet. An admin can connect it in System Master → Integration → AI.';
    if (codeOf(err) === 'FORBIDDEN') return "You can't ask questions about the company's data.";
    return 'I could not answer that just now. Try again, or ask it in the app.';
  }
}

/** A voice message is a spoken question: written down by the company's speech service, then asked. */
export async function voiceReply(
  db: Db,
  me: Me,
  appSecret: string,
  clip: { seconds: number; fetch: () => Promise<{ data: Buffer; mime: string }> },
): Promise<string> {
  if (clip.seconds > 120) return 'That is a long one — keep a spoken question under two minutes.';
  let heard: string;
  try {
    const file = await clip.fetch();
    heard = await transcribeFor(
      db,
      { companyId: me.companyId, userId: me.id },
      appSecret,
      file.data,
      file.mime,
      me.lang === 'hi' ? 'hi' : 'en',
    );
  } catch (err) {
    if (codeOf(err) === 'AI_NOT_CONNECTED')
      return 'Voice questions need speech to text (your own Whisper server, OpenAI Whisper or Gemini) chosen in System Master → Integration → AI. Until then, type: /ask your question';
    return 'I could not hear that. Try again, or type: /ask your question';
  }
  if (heard.trim().length < 3)
    return 'I could not make out any words. Try again, or type: /ask your question';
  return `You asked: "${heard.trim()}"\n\n${await askReply(db, me, appSecret, heard)}`;
}
