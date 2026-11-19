import type { Db } from '@mono/db';
import type { Env } from '../../env';
import { channelClients } from '../../lib/channels/config';
import { sendEmail } from '../../lib/channels/email';
import { sendTelegram } from '../../lib/channels/telegram';
import { runChecks, type Check } from './checks';

/** A problem is told again only after this long (while it lasts). */
const REPEAT_MS = 6 * 60 * 60_000;

type Log = { warn: (o: object, msg: string) => void; info: (o: object, msg: string) => void };

/**
 * Watches the health checks from the API process — not the worker, because "the worker stopped" is one of
 * the things to tell — and writes to every Owner and Admin directly (Telegram and email, not through the
 * outbox, which the worker sends). A problem is told once, again after six hours while it lasts, and once
 * more when it is over. Several API copies never tell twice: the "told" mark is taken with one statement.
 */
export async function watchHealth(db: Db, env: Env, opts: { startedAt: Date; log: Log; now?: Date }) {
  const now = opts.now ?? new Date();
  const checks = await runChecks(db, {
    uploadDir: env.UPLOAD_DIR,
    production: env.NODE_ENV === 'production',
    startedAt: opts.startedAt,
    now,
  });
  const told: string[] = [];
  for (const c of checks) {
    const key = `alerted:${c.key}`;
    if (c.state === 'fail') {
      // Take the right to tell: a new mark, or one older than the repeat time.
      const took = await db.$executeRaw`
        INSERT INTO ops_marks (key, ok, note, at) VALUES (${key}, false, ${c.message}, ${now})
        ON CONFLICT (key) DO UPDATE SET note = EXCLUDED.note, at = EXCLUDED.at
        WHERE ops_marks.at < ${new Date(now.getTime() - REPEAT_MS)}`;
      if (took) {
        await tell(db, env, `⚠️ ${env.APP_NAME}: ${c.message}`, opts.log);
        told.push(c.key);
      }
    } else if (c.state === 'ok') {
      const gone = await db.opsMark.deleteMany({ where: { key } });
      if (gone.count) {
        await tell(db, env, `✅ ${env.APP_NAME}: back to normal — ${label(c)}`, opts.log);
        told.push(`${c.key} (over)`);
      }
    }
  }
  return told;
}

const label = (c: Check) => `${c.key}: ${c.message}`;

/** Every active Owner and Admin of every company, on Telegram and by email — whatever each company has set up. */
async function tell(db: Db, env: Env, text: string, log: Log) {
  const people = await db.user.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      role: { key: { in: ['OWNER', 'ADMIN'] } },
      company: { deletedAt: null },
    },
    select: { companyId: true, email: true, telegramChatId: true },
  });
  const clients = new Map<string, Awaited<ReturnType<typeof channelClients>>>();
  let sent = 0;
  for (const p of people) {
    try {
      if (!clients.has(p.companyId)) clients.set(p.companyId, await channelClients(db, p.companyId, env));
      const c = clients.get(p.companyId)!;
      const link = `${env.BASE_URL.replace(/\/$/, '')}/system/errors`;
      if (c.telegram && p.telegramChatId) {
        await sendTelegram(c.telegram.token, p.telegramChatId, { text: escape(text), link });
        sent += 1;
      }
      if (c.email && p.email) {
        await sendEmail(
          c.email.transport,
          c.email.from,
          p.email,
          { text, link, subject: text.slice(0, 120) },
          env.APP_NAME,
        );
        sent += 1;
      }
    } catch (err) {
      log.warn({ err }, 'A health alert could not be sent');
    }
  }
  log.info({ text, sent }, 'Health alert');
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
