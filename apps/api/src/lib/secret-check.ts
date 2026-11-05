import type { Db } from '@mono/db';
import { decryptJson } from './secrets';

/**
 * After a restore with a different APP_SECRET, every saved secret (bot tokens, AI keys, Drive, webhooks) is
 * unreadable. Say so loudly at start-up instead of failing quietly at 3 a.m. Returns the problem, or null.
 */
export async function checkSecrets(db: Db, secret: string): Promise<string | null> {
  const samples = [
    ...(
      await db.channelConfig.findMany({ where: { secret: { not: null } }, select: { secret: true }, take: 1 })
    ).map((r) => r.secret),
    ...(
      await db.aiConfig.findMany({ where: { secret: { not: null } }, select: { secret: true }, take: 1 })
    ).map((r) => r.secret),
    ...(await db.webhook.findMany({ select: { secret: true }, take: 1 })).map((r) => r.secret),
    ...(await db.driveConnection.findMany({ select: { secrets: true }, take: 1 })).map((r) => r.secrets),
  ];
  for (const s of samples) {
    try {
      decryptJson(s, secret);
    } catch {
      return 'APP_SECRET does not match the one these saved secrets were made with. Put the original APP_SECRET back in .env (from your password manager), or enter the bot token, AI key, Drive and webhooks again.';
    }
  }
  return null;
}
