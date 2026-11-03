import { createId } from '@paralleldrive/cuid2';
import { Readable } from 'node:stream';
import type { Db } from '@mono/db';
import {
  actorFor,
  boardOwners,
  captureEa,
  emitEvent,
  moduleSettings,
  redeemLinkCode,
  type Storage,
} from '@mono/api/services';
import { doneCommand, moveCommand, taskButton, workSummary, type BotButton } from './bot-work';

/** Bot logic as plain functions (easy to test); telegram-bot.ts only forwards updates to them. */
export type BotScope = { companyIds: string[] | null };
/** A reply, optionally with one row of buttons per action. */
export type BotReply = { text: string; buttons?: BotButton[] };
const reply = (text: string, buttons?: BotButton[]): BotReply => ({
  text,
  ...(buttons?.length ? { buttons } : {}),
});

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
    return `Hello ${me.name}. You're linked to ${appName}.\n\n${helpText(await canCapture(db, scope, chatId))}`;
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

/** /my and /today: tasks, checklists and verifications first (with one-tap buttons), then unread messages. */
export async function onMy(
  db: Db,
  scope: BotScope,
  chatId: string,
  appName: string,
  today = false,
): Promise<BotReply> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return reply(`This Telegram is not linked yet. Send your 8-character code from ${appName}.`);
  const work = await workSummary(db, { id: me.id, companyId: me.companyId }, today);
  const items = await db.notification.findMany({
    where: { userId: me.id, readAt: null },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const later = work.later ? `\n\n${work.later} more due later — send /my to see everything.` : '';
  if (!work.lines.length && !items.length)
    return reply((today ? 'Nothing due today. 👍' : 'Nothing waiting on you. 👍') + later);
  const out = [`${today ? 'Due today (and anything late)' : 'Waiting on you'}:`, ...work.lines];
  if (items.length) out.push('', 'Unread:', ...items.map((n) => `• ${n.title}`));
  if (work.firstTask !== null)
    out.push(
      '',
      `Tap a button, or: /done ${work.firstTask} what you did · /move ${work.firstTask} DD/MM/YYYY HH:mm reason`,
    );
  return reply(out.join('\n') + later, work.buttons);
}

/** /done with no number: the open tasks, each with its Done button. */
async function onDoneList(db: Db, scope: BotScope, chatId: string, appName: string): Promise<BotReply> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return reply(`This Telegram is not linked yet. Send your 8-character code from ${appName}.`);
  const work = await workSummary(db, { id: me.id, companyId: me.companyId }, false);
  const done = work.buttons.filter((b) => b.data.startsWith('act:done:'));
  if (!done.length) return reply('You have no open tasks to mark done. 👍');
  return reply('Which task is done? Tap it, or send /done <number> <what you did>.', done);
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
  const actor = await actorFor(db, me.companyId, me.id);
  if (!actor) return 'Your account is not active.';
  try {
    const item = await captureEa(db, actor, { text: text.trim().slice(0, 500), source: 'telegram' });
    return `📝 Captured #${item.number}. It's on the EA board.`;
  } catch {
    return 'Only the owner and the EA can add to the EA board.';
  }
}

/** Plain text from a board owner or the EA is a capture; anyone else gets the usual hello. */
export async function canCapture(db: Db, scope: BotScope, chatId: string): Promise<boolean> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return false;
  const [owners, s] = await Promise.all([
    boardOwners(db, me.companyId),
    moduleSettings(db, me.companyId, 'ea'),
  ]);
  return owners.some((o) => o.id === me.id) || s.eaUserId === me.id;
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

/** Inline buttons: act:<accept|done|verify|move>:<entityType>:<entityId> */
export async function onAction(db: Db, scope: BotScope, chatId: string, data: string): Promise<string> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return 'Link your Telegram first.';
  const [, action, entityType, entityId] = data.split(':');
  if (entityType === 'task' && action && entityId)
    return taskButton(db, { id: me.id, companyId: me.companyId }, action, entityId);
  return "That button isn't something the bot can do yet — open the app for it.";
}

/** What the bot can do — /capture only for the people who can use it (the owner and the EA). */
export function helpText(capture: boolean) {
  return [
    '/my — everything waiting on you',
    '/today — due today, and anything late',
    '/done 12 what you did — mark task #12 done (just /done lists your tasks)',
    '/move 12 05/11/2026 18:00 reason — move task #12',
    ...(capture ? ['/capture <text> — note something on the EA board (or just type it)'] : []),
    'Reply to a task message with a photo to attach proof.',
  ].join('\n');
}

/**
 * Every text message the bot gets, in one place: slash commands (with or without @botname),
 * link codes, EA captures from the owner/EA, and a hello for anything else.
 */
export async function onText(
  db: Db,
  scope: BotScope,
  chatId: string,
  text: string,
  appName: string,
): Promise<BotReply> {
  const t = text.trim();
  const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(t);
  if (cmd) {
    const name = cmd[1]!.toLowerCase();
    const args = (cmd[2] ?? '').trim();
    switch (name) {
      case 'start':
        return reply(await onStart(db, scope, chatId, args || undefined, appName));
      case 'help':
        return reply(helpText(await canCapture(db, scope, chatId)));
      case 'my':
        return onMy(db, scope, chatId, appName);
      case 'today':
        return onMy(db, scope, chatId, appName, true);
      case 'capture':
        return reply(await onCapture(db, scope, chatId, args, appName));
      case 'done':
        return args
          ? reply(await onCommand(db, scope, chatId, 'done', args))
          : onDoneList(db, scope, chatId, appName);
      case 'move':
        return reply(await onCommand(db, scope, chatId, 'move', args));
      default:
        return reply(`I don't know /${name}.\n\n${helpText(await canCapture(db, scope, chatId))}`);
    }
  }
  if (looksLikeCode(t)) return reply(await onCode(db, chatId, t, appName));
  if (t && (await canCapture(db, scope, chatId)))
    return reply(await onCapture(db, scope, chatId, t, appName));
  return reply(await onStart(db, scope, chatId, undefined, appName));
}

/**
 * Telegram doesn't tell bots when a message is read. So anything the person does in the chat
 * (a button, a command, any message) counts as having seen everything we delivered there before it.
 */
export async function markSeen(db: Db, scope: BotScope, chatId: string, now = new Date()): Promise<number> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return 0;
  const sent = await db.outbox.findMany({
    where: {
      channel: 'telegram',
      userId: me.id,
      status: 'SENT',
      eventId: { not: null },
      sentAt: { lte: now },
    },
    select: { eventId: true },
    distinct: ['eventId'],
    orderBy: { eventId: 'asc' },
    take: 500,
  });
  if (!sent.length) return 0;
  const res = await db.notification.updateMany({
    where: { userId: me.id, readAt: null, eventId: { in: sent.map((x) => x.eventId!) } },
    data: { readAt: now },
  });
  if (res.count)
    await db.$transaction((tx) =>
      emitEvent(
        tx,
        { companyId: me.companyId, actorId: me.id },
        {
          name: 'notification.read',
          entityType: 'user',
          entityId: me.id,
          payload: { count: res.count, via: 'telegram' },
        },
      ),
    );
  return res.count;
}

export async function onCommand(
  db: Db,
  scope: BotScope,
  chatId: string,
  command: 'done' | 'move',
  args: string,
): Promise<string> {
  const me = await whoIs(db, scope, chatId);
  if (!me) return 'Link your Telegram first.';
  const who = { id: me.id, companyId: me.companyId };
  return command === 'done' ? doneCommand(db, who, args) : moveCommand(db, who, args);
}
