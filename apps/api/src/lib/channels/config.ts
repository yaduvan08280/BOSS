import type { Tx } from '@mono/db';
import type { Env } from '../../env';
import { decryptJson, encryptJson } from '../secrets';
import { smtpTransport, type SmtpConfig } from './email';
import type { VapidKeys } from './push';
import { whatsappProvider, type WhatsAppConfig, type WhatsAppProvider } from './whatsapp';
import type { Fetch } from './types';

export const CHANNEL_KEYS = ['email', 'telegram', 'whatsapp', 'push'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

/** Fields that are encrypted and never returned to the browser. */
export const SECRET_FIELDS: Record<ChannelKey, string[]> = {
  email: ['pass'],
  telegram: ['token'],
  whatsapp: ['apiKey'],
  push: ['privateKey'],
};

export type ChannelState = { meta: Record<string, unknown>; secrets: Record<string, string>; saved: boolean };

export async function readChannel(
  db: Tx,
  companyId: string,
  channel: ChannelKey,
  appSecret: string,
): Promise<ChannelState> {
  const row = await db.channelConfig.findFirst({ where: { companyId, channel } });
  return {
    meta: (row?.meta ?? {}) as Record<string, unknown>,
    secrets: decryptJson<Record<string, string>>(row?.secret, appSecret) ?? {},
    saved: Boolean(row),
  };
}

/** Merge new settings in. A secret left empty keeps the stored one ("never shown again"). */
export async function saveChannel(
  db: Tx,
  companyId: string,
  channel: ChannelKey,
  input: Record<string, unknown>,
  appSecret: string,
  actorId: string | null,
  extraMeta: Record<string, unknown> = {},
) {
  const current = await readChannel(db, companyId, channel, appSecret);
  const secrets = { ...current.secrets };
  const meta: Record<string, unknown> = { ...current.meta, ...extraMeta };
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_FIELDS[channel].includes(k)) {
      if (typeof v === 'string' && v.length > 0) secrets[k] = v;
    } else if (v !== undefined) {
      meta[k] = v;
    }
  }
  // WhatsApp: switching provider resets the connection.
  if (
    channel === 'whatsapp' &&
    current.meta.provider &&
    input.provider &&
    input.provider !== current.meta.provider &&
    !input.apiKey
  ) {
    delete secrets.apiKey;
    delete meta.lastTestAt;
    delete meta.lastTestOk;
  }
  const secret = Object.keys(secrets).length ? encryptJson(secrets, appSecret) : null;
  await db.channelConfig.upsert({
    where: { companyId_channel: { companyId, channel } },
    create: { companyId, channel, secret, meta: meta as object, updatedById: actorId },
    update: { secret, meta: meta as object, updatedById: actorId },
  });
  return {
    meta,
    secretsSaved: Object.fromEntries(SECRET_FIELDS[channel].map((f) => [f, Boolean(secrets[f])])),
  };
}

export async function setChannelMeta(
  db: Tx,
  companyId: string,
  channel: ChannelKey,
  patch: Record<string, unknown>,
) {
  const row = await db.channelConfig.findFirst({ where: { companyId, channel } });
  const meta = { ...((row?.meta ?? {}) as Record<string, unknown>), ...patch };
  await db.channelConfig.upsert({
    where: { companyId_channel: { companyId, channel } },
    create: { companyId, channel, meta: meta as object },
    update: { meta: meta as object },
  });
}

export type ChannelClients = {
  telegram: { token: string; groupChatId: string | null; botUsername: string | null } | null;
  email: { transport: ReturnType<typeof smtpTransport>; from: string } | null;
  whatsapp: WhatsAppProvider | null;
  push: VapidKeys | null;
};

/** Everything needed to send for one company: its own settings first, then the server-wide .env defaults. */
export async function channelClients(
  db: Tx,
  companyId: string,
  env: Env,
  f?: Fetch,
): Promise<ChannelClients> {
  // Same order as CHANNEL_KEYS: email, telegram, whatsapp, push.
  const [em, tg, wa, push] = await Promise.all(
    CHANNEL_KEYS.map((c) => readChannel(db, companyId, c, env.APP_SECRET)),
  );
  const token = tg!.secrets.token || env.TELEGRAM_BOT_TOKEN;
  const smtp: SmtpConfig | null = em!.meta.host
    ? {
        host: String(em!.meta.host),
        port: Number(em!.meta.port ?? 587),
        secure: Boolean(em!.meta.secure),
        user: em!.meta.user ? String(em!.meta.user) : undefined,
        pass: em!.secrets.pass,
        from: String(em!.meta.from ?? ''),
      }
    : env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_PORT === 465,
          user: env.SMTP_USER || undefined,
          pass: env.SMTP_PASS,
          from: env.SMTP_FROM || env.SMTP_USER,
        }
      : null;
  const waCfg =
    wa!.meta.provider && wa!.secrets.apiKey
      ? ({ ...(wa!.meta as object), apiKey: wa!.secrets.apiKey } as WhatsAppConfig)
      : null;
  const vapid =
    push!.meta.publicKey && push!.secrets.privateKey
      ? {
          publicKey: String(push!.meta.publicKey),
          privateKey: push!.secrets.privateKey,
          subject: String(push!.meta.subject ?? `mailto:admin@${new URL(env.BASE_URL).hostname}`),
        }
      : env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? {
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: env.VAPID_SUBJECT || `mailto:admin@${new URL(env.BASE_URL).hostname}`,
          }
        : null;
  let whatsapp: WhatsAppProvider | null;
  try {
    whatsapp = waCfg ? whatsappProvider(waCfg, f) : null;
  } catch {
    // An unsupported provider means "not connected" rather than an error on every send.
    whatsapp = null;
  }
  return {
    telegram: token
      ? {
          token,
          groupChatId: (tg!.meta.groupChatId as string) || null,
          botUsername: (tg!.meta.botUsername as string) || null,
        }
      : null,
    email: smtp ? { transport: smtpTransport(smtp), from: smtp.from } : null,
    whatsapp,
    push: vapid,
  };
}
