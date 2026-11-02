import { randomInt } from 'node:crypto';
import type { Db, Tx } from '@mono/db';
import { emitEvent } from './events';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_TTL_HOURS = 24;

export function makeCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/** A fresh 8-character code for one person; earlier unused codes stop working. */
export async function newLinkCode(tx: Tx, companyId: string, userId: string, sentVia: string) {
  await tx.telegramLinkCode.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    if (await tx.telegramLinkCode.findUnique({ where: { code } })) continue;
    return tx.telegramLinkCode.create({
      data: { companyId, userId, code, sentVia, expiresAt: new Date(Date.now() + CODE_TTL_HOURS * 3600_000) },
    });
  }
  throw new Error('Could not create a unique code');
}

export type RedeemResult =
  { ok: true; userName: string; companyName: string } | { ok: false; reason: 'unknown' | 'expired' | 'used' };

/** The bot calls this when someone sends a code: link that Telegram chat to the person. */
export async function redeemLinkCode(db: Db, rawCode: string, chatId: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase().replace(/\s|-/g, '');
  const row = await db.telegramLinkCode.findUnique({ where: { code } });
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.usedAt) return { ok: false, reason: 'used' };
  if (row.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  return db.$transaction(async (tx) => {
    // One chat belongs to one person per company.
    await tx.user.updateMany({
      where: { companyId: row.companyId, telegramChatId: chatId, id: { not: row.userId } },
      data: { telegramChatId: null },
    });
    const user = await tx.user.update({
      where: { id: row.userId },
      data: { telegramChatId: chatId },
      select: { name: true, company: { select: { name: true } } },
    });
    await tx.telegramLinkCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await emitEvent(
      tx,
      { companyId: row.companyId, actorId: row.userId },
      { name: 'telegram.linked', entityType: 'user', entityId: row.userId },
    );
    return { ok: true as const, userName: user.name, companyName: user.company.name };
  });
}
