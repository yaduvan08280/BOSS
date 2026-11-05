import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '@mono/db';
import { channelConfigSchemas } from '@mono/shared';
import type { Env } from '../../env';
import {
  CHANNEL_KEYS,
  channelClients,
  readChannel,
  saveChannel,
  SECRET_FIELDS,
  setChannelMeta,
  type ChannelKey,
} from '../../lib/channels/config';
import { sendEmail } from '../../lib/channels/email';
import { generateVapidKeys, sendPush } from '../../lib/channels/push';
import { sendTelegram, telegramGetMe } from '../../lib/channels/telegram';
import { AppError } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';
import { assertPublicUrl } from '../platform/safe-url';

const channelParam = z.object({ channel: z.enum(CHANNEL_KEYS) });

/** System Master → Integration: WhatsApp API, Connect channels (email, Telegram bot, web push). */
export async function channelRoutes(app: FastifyInstance, opts: { env: Env }) {
  const { env } = opts;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { onRequest: [app.requirePermission('integrations.admin')] };

  r.get('/api/notify/channels', { ...admin, schema: { tags: ['notify'] } }, async (request) => {
    const db = request.db as unknown as Tx;
    const out: Record<string, unknown> = {};
    for (const c of CHANNEL_KEYS) {
      const s = await readChannel(db, request.auth!.companyId, c, env.APP_SECRET);
      out[c] = {
        saved: s.saved,
        meta: s.meta,
        secretsSaved: Object.fromEntries(SECRET_FIELDS[c].map((f) => [f, Boolean(s.secrets[f])])),
      };
    }
    out.envDefaults = {
      email: Boolean(env.SMTP_HOST),
      telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
      push: Boolean(env.VAPID_PUBLIC_KEY),
    };
    return out;
  });

  r.put(
    '/api/notify/channels/:channel',
    { ...admin, schema: { tags: ['notify'], params: channelParam, body: z.record(z.string(), z.unknown()) } },
    async (request) => {
      const channel = request.params.channel as ChannelKey;
      const parsed = channelConfigSchemas[channel].safeParse(request.body);
      if (!parsed.success)
        throw new AppError(400, 'VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Check the fields', {
          issues: parsed.error.issues,
        });
      const extra: Record<string, unknown> = {};
      const endpoint = (parsed.data as { endpoint?: string }).endpoint;
      if (channel === 'whatsapp' && endpoint) {
        // The provider's address is called from the server: never one inside its own network.
        const production = env.NODE_ENV === 'production';
        await assertPublicUrl(endpoint, {
          production,
          allowPrivate: env.WEBHOOK_ALLOW_PRIVATE && !production,
        }).catch((e: Error) => {
          throw new AppError(400, 'VALIDATION_FAILED', e.message);
        });
      }
      if (channel === 'telegram' && 'token' in parsed.data && parsed.data.token) {
        // Check the token right away so a typo is caught here, not at 3 a.m.
        const bot = await telegramGetMe(parsed.data.token).catch((e: Error) => {
          throw new AppError(400, 'VALIDATION_FAILED', e.message);
        });
        extra.botUsername = bot.username;
      }
      return inCompanyTx(request, async (tx, ctx) => {
        const saved = await saveChannel(
          tx,
          ctx.companyId,
          channel,
          parsed.data as Record<string, unknown>,
          env.APP_SECRET,
          ctx.actorId,
          extra,
        );
        await recordChange(tx, ctx, {
          event: 'channel.updated',
          entityType: 'channel',
          entityId: channel,
          after: saved.meta,
          payload: { channel },
        });
        return saved;
      });
    },
  );

  r.post(
    '/api/notify/channels/:channel/test',
    {
      ...admin,
      schema: {
        tags: ['notify'],
        params: channelParam,
        body: z.object({ to: z.string().max(200).optional() }),
      },
    },
    async (request) => {
      const channel = request.params.channel as ChannelKey;
      const db = request.db as unknown as Tx;
      const companyId = request.auth!.companyId;
      const me = await db.user.findUniqueOrThrow({
        where: { id: request.auth!.userId },
        select: { name: true, email: true, mobile: true, telegramChatId: true },
      });
      const clients = await channelClients(db, companyId, env);
      const text = `Test from ${env.APP_NAME}: this channel works.`;
      let message: string;
      try {
        if (channel === 'email') {
          if (!clients.email) throw new Error('Save the SMTP settings first');
          const to = request.body.to || me.email;
          if (!to) throw new Error('Add your email in your profile, or type an address to send to');
          await sendEmail(
            clients.email.transport,
            clients.email.from,
            to,
            { text, subject: `${env.APP_NAME} test email` },
            env.APP_NAME,
          );
          message = `Sent to ${to}`;
        } else if (channel === 'telegram') {
          if (!clients.telegram) throw new Error('Save the bot token first');
          const bot = await telegramGetMe(clients.telegram.token);
          const chat = request.body.to || me.telegramChatId || clients.telegram.groupChatId;
          if (chat)
            await sendTelegram(clients.telegram.token, chat, { text: `<b>${env.APP_NAME}</b>\n${text}` });
          message = chat
            ? `@${bot.username} sent a message to ${chat === me.telegramChatId ? 'your Telegram' : chat}`
            : `@${bot.username} is connected. Link your Telegram to receive a test.`;
        } else if (channel === 'whatsapp') {
          if (!clients.whatsapp) throw new Error('Choose a provider and save the API key first');
          message = await clients.whatsapp.test();
        } else {
          if (!clients.push) throw new Error('Create the web push keys first');
          const subs = await db.pushSubscription.findMany({ where: { userId: request.auth!.userId } });
          if (!subs.length)
            throw new Error('Turn on notifications on this device first (Profile → Phone notifications)');
          for (const s of subs) await sendPush(clients.push, s, { title: env.APP_NAME, text, link: '/' });
          message = `Sent to ${subs.length} device(s)`;
        }
        await setChannelMeta(db, companyId, channel, {
          lastTestAt: new Date().toISOString(),
          lastTestOk: true,
          lastTestMessage: message,
        });
        return { ok: true, message };
      } catch (err) {
        const msg = (err as Error).message;
        await setChannelMeta(db, companyId, channel, {
          lastTestAt: new Date().toISOString(),
          lastTestOk: false,
          lastTestMessage: msg,
        });
        throw new AppError(400, 'BAD_REQUEST', msg);
      }
    },
  );

  r.post('/api/notify/push/keys', { ...admin, schema: { tags: ['notify'] } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      const keys = generateVapidKeys();
      await saveChannel(
        tx,
        ctx.companyId,
        'push',
        { publicKey: keys.publicKey, privateKey: keys.privateKey },
        env.APP_SECRET,
        ctx.actorId,
      );
      // Old browser subscriptions belong to the old keys.
      await tx.pushSubscription.deleteMany({ where: { companyId: ctx.companyId } });
      await recordChange(tx, ctx, {
        event: 'channel.updated',
        entityType: 'channel',
        entityId: 'push',
        payload: { channel: 'push' },
      });
      return { publicKey: keys.publicKey };
    }),
  );
}
