import { Bot, type Context } from 'grammy';
import type { Logger } from 'pino';
import type { Db } from '@mono/db';
import type { Env } from '@mono/api/env';
import { readChannel, setChannelMeta, type Storage } from '@mono/api/services';
import {
  canCapture,
  markSeen,
  onAck,
  onAction,
  onProof,
  onText,
  type BotReply,
  type BotScope,
} from './bot-handlers';

const COMMANDS = [
  { command: 'my', description: "What's waiting on you" },
  { command: 'today', description: 'Due today, and anything late' },
  { command: 'done', description: 'Mark a task done (lists your tasks)' },
  { command: 'move', description: 'Move a date: /move 12 05/11/2026 18:00 reason' },
  { command: 'help', description: 'What the bot can do' },
];
const CAPTURE_COMMANDS = [
  ...COMMANDS.slice(0, 4),
  { command: 'capture', description: 'Note something on the EA board' },
  COMMANDS[4]!,
];

/**
 * Runs one long-polling bot per distinct token: a company's own bot, plus the .env bot for companies
 * without one. Restarted whenever Telegram settings change.
 */
export class BotManager {
  private bots = new Map<string, Bot>();

  constructor(
    private readonly db: Db,
    private readonly env: Env,
    private readonly storage: Storage,
    private readonly log: Logger,
  ) {}

  async sync(): Promise<void> {
    const companies = await this.db.company.findMany({ where: { deletedAt: null }, select: { id: true } });
    const byToken = new Map<string, string[] | null>();
    const withoutOwn: string[] = [];
    for (const c of companies) {
      const cfg = await readChannel(this.db as never, c.id, 'telegram', this.env.APP_SECRET);
      if (cfg.secrets.token)
        byToken.set(cfg.secrets.token, [...(byToken.get(cfg.secrets.token) ?? []), c.id]);
      else withoutOwn.push(c.id);
    }
    if (this.env.TELEGRAM_BOT_TOKEN && withoutOwn.length && !byToken.has(this.env.TELEGRAM_BOT_TOKEN)) {
      byToken.set(this.env.TELEGRAM_BOT_TOKEN, withoutOwn);
    }
    for (const [token, bot] of this.bots) {
      if (!byToken.has(token)) {
        await bot.stop().catch(() => undefined);
        this.bots.delete(token);
      }
    }
    for (const [token, companyIds] of byToken) {
      if (this.bots.has(token))
        await this.bots
          .get(token)!
          .stop()
          .catch(() => undefined);
      this.bots.set(token, this.start(token, { companyIds }));
    }
  }

  private start(token: string, scope: BotScope): Bot {
    const { db, env, storage, log } = this;
    const app = env.APP_NAME;
    const bot = new Bot(token);
    const chat = (id: number | undefined) => String(id ?? '');

    const send = (ctx: Context, r: BotReply) =>
      ctx.reply(r.text, {
        ...(r.buttons?.length
          ? {
              reply_markup: {
                inline_keyboard: r.buttons.map((b) => [{ text: b.label, callback_data: b.data }]),
              },
            }
          : {}),
      });

    // The menu shows /capture only to the owner and the EA: their chat gets its own command list.
    const menus = new Map<string, boolean>();
    const syncMenu = async (chatId: string) => {
      const capture = await canCapture(db, scope, chatId);
      if (menus.get(chatId) === capture) return;
      menus.set(chatId, capture);
      const where = { type: 'chat' as const, chat_id: Number(chatId) };
      if (capture) await bot.api.setMyCommands(CAPTURE_COMMANDS, { scope: where });
      else await bot.api.deleteMyCommands({ scope: where });
    };

    // Any update from a linked chat means they saw what we sent before it (Telegram has no read receipts).
    bot.use(async (ctx, next) => {
      const id = ctx.chat?.id ?? ctx.from?.id;
      if (id) {
        await markSeen(db, scope, chat(id)).catch((err) => log.warn({ err }, 'mark seen failed'));
        await syncMenu(chat(id)).catch((err) => log.warn({ err }, 'command menu failed'));
      }
      await next();
    });

    bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      const chatId = chat(ctx.chat?.id ?? ctx.from.id);
      const text = data.startsWith('ack:')
        ? await onAck(db, scope, chatId, data.slice(4))
        : await onAction(db, scope, chatId, data);
      // The pop-up answer disappears quickly; say it in the chat too.
      await ctx.answerCallbackQuery({ text: text.slice(0, 190) });
      await ctx.reply(text);
    });

    bot.on('message:photo', async (ctx) => {
      const replyTo = ctx.message.reply_to_message?.message_id;
      if (!replyTo) return ctx.reply('To attach proof, reply to the message the photo belongs to.');
      const photo = ctx.message.photo.at(-1)!;
      const text = await onProof(db, storage, scope, chat(ctx.chat.id), replyTo, async () => {
        const file = await ctx.api.getFile(photo.file_id);
        const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
        return {
          data: Buffer.from(await res.arrayBuffer()),
          mime: 'image/jpeg',
          name: `telegram-${photo.file_unique_id}.jpg`,
        };
      });
      await ctx.reply(text);
    });

    bot.on('message:text', async (ctx) =>
      send(ctx, await onText(db, scope, chat(ctx.chat.id), ctx.message.text, app)),
    );

    bot.catch((err) => log.warn({ err: err.error }, 'Telegram bot error'));

    void bot.api.setMyCommands(COMMANDS).catch(() => undefined);

    bot
      .start({
        drop_pending_updates: false,
        onStart: async (me) => {
          log.info(
            { bot: me.username, companies: scope.companyIds?.length ?? 'all' },
            'Telegram bot polling',
          );
          for (const id of scope.companyIds ?? [])
            await setChannelMeta(db as never, id, 'telegram', { botUsername: me.username });
        },
      })
      .catch((err: Error) =>
        log.error({ err }, 'Telegram bot stopped (is the same token polled somewhere else?)'),
      );
    return bot;
  }

  async stop() {
    await Promise.all([...this.bots.values()].map((b) => b.stop().catch(() => undefined)));
    this.bots.clear();
  }
}
