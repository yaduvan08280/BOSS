import { createId } from '@paralleldrive/cuid2';
import { Readable } from 'node:stream';
import type { Db } from '@mono/db';
import { emitEvent, redeemLinkCode, type Storage } from '@mono/api/services';

/** Bot logic as plain functions (easy to test); telegram-bot.ts wires them to grammY. */
export type BotScope = { companyIds: string[] | null };

const CODE = /^[A-Z2-9]{8}$/i;

export function looksLikeCode(text: string) {
  return CODE.test(text.trim().replace(/[\s-]/g, ''));
}

async function whoIs(db: Db, scope: BotScope, chatId: string) {
  return db.user.findFirst({
    where: {
      telegramChatId: chatId,
      deletedAt: null,
      status: 'ACTIVE',
      ...(scope.companyIds ? { companyId: { in: scope.companyIds } } : {}),
    },
    select: { id: true, name: true, companyId: true, lang: true },
  });
}

export async function onStart(
  db: Db,
  scope: BotScope,
  chatId: string,
  arg: string | undefined,
  appName: string,
): Promise<string> {
  if (arg && looksLikeCode(arg)) return onCode(db, chatId, arg, appName);
  const me = await whoIs(db, scope, chatId);
  if (me)
    return `Hello ${me.name}. You're linked to ${appName}.\n\n/my — what's waiting on you\n/today — today's work\n/capture <text> — note something for the EA`;
  return `Welcome to ${appName}.\nSend the 8-character code from ${appName} (Profile → Link my Telegram) to connect your account.`;
}

export async function onCode(db: Db, chatId: string, code: string, appName: string): Promise<string> {
  const r = await redeemLinkCode(db, code, chatId);
  if (r.ok)
    return `✅ Linked. Hello ${r.userName}, your ${r.companyName} tasks and reminders will arrive here.\n\nTry /my`;
  if (r.reason === 'expired')
    return `That code has expired. Get a new one in ${appName} (Profile → Link my Telegram).`;
  if (r.reason === 'used') return 'That code was already used. If this is not your account, ask your admin.';
  return `I don't know that code. Check it and send it again, or get a new one in ${appName}.`;
}

/** /my and /today: unread notifications for now; work lists join in as the modules arrive (phase 3+). */
export async function onMy(
  db: Db,
  scope: BotScope,
  chatId: string,
  appName: string,
  today = false,
): Promise<string> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return `This Telegram is not linked yet. Send your 8-character code from ${appName}.`;
  const since = today ? new Date(Date.now() - 24 * 3600_000) : undefined;
  const items = await db.notification.findMany({
    where: { userId: me.id, readAt: null, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  if (!items.length) return today ? 'Nothing new today. 👍' : 'Nothing waiting on you. 👍';
  return [
    `${today ? 'Today' : 'Waiting on you'} (${items.length}):`,
    ...items.map((n, i) => `${i + 1}. ${n.title}`),
  ].join('\n');
}

export async function onCapture(
  db: Db,
  scope: BotScope,
  chatId: string,
  text: string,
  appName: string,
): Promise<string> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return `This Telegram is not linked yet. Send your 8-character code from ${appName}.`;
  if (!text.trim()) return 'Write what to capture after the command, e.g. /capture Call the GST consultant';
  return 'Got it. Captures go to the EA board, which arrives in phase 4. For now this note was not saved.';
}

/** "Seen ✓" button: marks the in-app notification read, which also counts as a reply for escalations. */
export async function onAck(
  db: Db,
  scope: BotScope,
  chatId: string,
  notificationId: string,
): Promise<string> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return 'Link your Telegram first.';
  const n = await db.notification.findFirst({ where: { id: notificationId, userId: me.id } });
  if (!n) return 'This message is not for you.';
  if (!n.readAt) {
    await db.$transaction(async (tx) => {
      await tx.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
      await emitEvent(
        tx,
        { companyId: me.companyId, actorId: me.id },
        {
          name: 'notification.read',
          entityType: n.entityType ?? 'notification',
          entityId: n.entityId ?? n.id,
          payload: { notificationId: n.id, eventId: n.eventId, via: 'telegram' },
        },
      );
    });
  }
  return 'Marked as seen ✓';
}

/**
 * Photo sent as a reply to one of our messages = proof for that record.
 * `download` fetches the Telegram file; the photo is stored like any other upload.
 */
export async function onProof(
  db: Db,
  storage: Storage,
  scope: BotScope,
  chatId: string,
  repliedMessageId: number,
  download: () => Promise<{ data: Buffer; mime: string; name: string }>,
): Promise<string> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return 'Link your Telegram first.';
  const sent = await db.outbox.findFirst({
    where: { channel: 'telegram', providerId: `${chatId}:${repliedMessageId}`, userId: me.id },
  });
  if (!sent?.entityType || !sent.entityId) return 'Reply with the photo to the message it belongs to.';
  const file = await download();
  if (file.data.length > 10 * 1024 * 1024) return 'That photo is larger than 10 MB.';
  const id = createId();
  const now = new Date();
  const path = `${me.companyId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.jpg`;
  const size = await storage.put(path, Readable.from(file.data));
  await db.$transaction(async (tx) => {
    await tx.attachment.create({
      data: {
        id,
        companyId: me.companyId,
        entityType: sent.entityType!,
        entityId: sent.entityId!,
        path,
        mime: file.mime,
        size,
        originalName: file.name,
        uploadedById: me.id,
      },
    });
    await emitEvent(
      tx,
      { companyId: me.companyId, actorId: me.id },
      {
        name: 'proof.attached',
        entityType: sent.entityType!,
        entityId: sent.entityId!,
        payload: { attachmentId: id, via: 'telegram' },
      },
    );
  });
  return '📎 Photo saved as proof.';
}

export async function onAction(db: Db, scope: BotScope, chatId: string, data: string): Promise<string> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return 'Link your Telegram first.';
  // Accept / Done / Move date are wired to tasks, checklists and steps as those modules arrive (phase 3+).
  void data;
  return 'Please do this in the app for now; buttons go live with tasks in phase 3.';
}
