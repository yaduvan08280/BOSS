import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '@mono/db';
import type { Env } from '../../env';
import { channelClients, saveChannel } from '../../lib/channels/config';
import { sendTelegram } from '../../lib/channels/telegram';
import { AppError } from '../../lib/errors';
import { emitEvent, recordChange } from '../../lib/events';
import { newLinkCode } from '../../lib/telegram-link';
import { inCompanyTx } from '../../lib/tx';

/** Link Telegram: codes, the people table, "Send codes to all not linked", admin group. */
export async function telegramRoutes(app: FastifyInstance, opts: { env: Env }) {
  const { env } = opts;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { onRequest: [app.requirePermission('integrations.admin')] };

  const botName = async (db: Tx, companyId: string) =>
    (await channelClients(db, companyId, env)).telegram?.botUsername ?? null;

  r.get('/api/notify/telegram', { ...admin, schema: { tags: ['notify'] } }, async (request) => {
    const db = request.db as unknown as Tx;
    const people = await db.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, mobile: true, email: true, telegramChatId: true },
      orderBy: { name: 'asc' },
    });
    const codes = await db.telegramLinkCode.findMany({
      where: { usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const latest = new Map<string, (typeof codes)[number]>();
    for (const c of codes) if (!latest.has(c.userId)) latest.set(c.userId, c);
    const now = new Date();
    const rows = people.map((p) => {
      const c = latest.get(p.id);
      const state = p.telegramChatId ? 'linked' : !c ? 'none' : c.expiresAt > now ? 'pending' : 'expired';
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        mobile: p.mobile,
        email: p.email,
        state,
        linkCode: state === 'pending' ? c!.code : null,
        sentAt: c?.createdAt ?? null,
        sentVia: c?.sentVia ?? null,
      };
    });
    const clients = await channelClients(db, request.auth!.companyId, env);
    return {
      bot: clients.telegram?.botUsername ?? null,
      connected: Boolean(clients.telegram),
      groupChatId: clients.telegram?.groupChatId ?? null,
      stats: {
        linked: rows.filter((x) => x.state === 'linked').length,
        total: rows.length,
        pending: rows.filter((x) => x.state === 'pending').length,
        expired: rows.filter((x) => x.state === 'expired').length,
      },
      people: rows,
    };
  });

  /** Anyone: "Link my Telegram". Returns the code and a one-tap deep link. */
  r.post(
    '/api/notify/telegram/my-code',
    { onRequest: [app.authenticate], schema: { tags: ['notify'] } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const bot = await botName(tx, ctx.companyId);
        if (!bot)
          throw new AppError(
            400,
            'BAD_REQUEST',
            'Telegram is not connected yet. Ask your admin to add the bot in System Master → Integration.',
          );
        const row = await newLinkCode(tx, ctx.companyId, ctx.actorId, 'screen');
        return {
          code: row.code,
          bot,
          deepLink: `https://t.me/${bot}?start=${row.code}`,
          expiresAt: row.expiresAt,
        };
      }),
  );

  r.get(
    '/api/notify/telegram/me',
    { onRequest: [app.authenticate], schema: { tags: ['notify'] } },
    async (request) => {
      const user = await request.db.user.findFirstOrThrow({
        where: { id: request.auth!.userId },
        select: { telegramChatId: true },
      });
      return {
        linked: Boolean(user.telegramChatId),
        bot: await botName(request.db as unknown as Tx, request.auth!.companyId),
      };
    },
  );

  r.post(
    '/api/notify/telegram/unlink',
    {
      onRequest: [app.authenticate],
      schema: { tags: ['notify'], body: z.object({ userId: z.string().optional() }) },
    },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const target = request.body.userId ?? ctx.actorId;
        if (
          target !== ctx.actorId &&
          !request.auth!.permissions.some((p) => p === '*' || p === 'integrations.admin')
        ) {
          throw new AppError(403, 'FORBIDDEN', 'You can only unlink your own Telegram');
        }
        await tx.user.update({ where: { id: target }, data: { telegramChatId: null } });
        await recordChange(tx, ctx, {
          event: 'user.updated',
          entityType: 'user',
          entityId: target,
          after: { telegram: 'unlinked' },
        });
        return { ok: true };
      }),
  );

  /** Codes go out by WhatsApp/email through the normal rules; anyone without those gets their code shown here. */
  r.post(
    '/api/notify/telegram/send-codes',
    {
      ...admin,
      schema: { tags: ['notify'], body: z.object({ userIds: z.array(z.string()).max(500).optional() }) },
    },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const bot = await botName(tx, ctx.companyId);
        if (!bot)
          throw new AppError(400, 'BAD_REQUEST', 'Connect the Telegram bot first (Connect channels tab)');
        const targets = await tx.user.findMany({
          where: {
            deletedAt: null,
            status: 'ACTIVE',
            telegramChatId: null,
            ...(request.body.userIds ? { id: { in: request.body.userIds } } : {}),
          },
          select: { id: true, name: true, mobile: true, email: true },
        });
        const shown: { name: string; code: string }[] = [];
        for (const u of targets) {
          const via = u.mobile ? 'whatsapp' : u.email ? 'email' : 'screen';
          const row = await newLinkCode(tx, ctx.companyId, u.id, via);
          await emitEvent(tx, ctx, {
            name: 'notify.telegram_code',
            entityType: 'user',
            entityId: u.id,
            payload: {
              userId: u.id,
              code: row.code,
              bot: `@${bot}`,
              link: `https://t.me/${bot}?start=${row.code}`,
            },
          });
          if (via === 'screen') shown.push({ name: u.name, code: row.code });
        }
        await recordChange(tx, ctx, {
          event: 'telegram.codes_sent',
          entityType: 'company',
          entityId: ctx.companyId,
          payload: { count: targets.length },
        });
        return { sent: targets.length, shown };
      }),
  );

  r.put(
    '/api/notify/telegram/group',
    {
      ...admin,
      schema: {
        tags: ['notify'],
        body: z.object({
          groupChatId: z
            .string()
            .trim()
            .regex(/^-?\d{5,20}$/, 'Group chat IDs are numbers, usually starting with -100')
            .nullable(),
        }),
      },
    },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const clients = await channelClients(tx, ctx.companyId, env);
        if (!clients.telegram) throw new AppError(400, 'BAD_REQUEST', 'Connect the Telegram bot first');
        if (request.body.groupChatId) {
          await sendTelegram(clients.telegram.token, request.body.groupChatId, {
            text: `<b>${env.APP_NAME}</b>\nThis group will now receive a copy of every notification.`,
          }).catch((e: Error) => {
            throw new AppError(
              400,
              'BAD_REQUEST',
              `${e.message}. Add @${clients.telegram!.botUsername} to the group first.`,
            );
          });
        }
        await saveChannel(
          tx,
          ctx.companyId,
          'telegram',
          { groupChatId: request.body.groupChatId },
          env.APP_SECRET,
          ctx.actorId,
        );
        await recordChange(tx, ctx, {
          event: 'channel.updated',
          entityType: 'channel',
          entityId: 'telegram',
          payload: { channel: 'telegram', group: request.body.groupChatId },
        });
        return { ok: true };
      }),
  );
}
