import type { Db, DomainEvent, Prisma } from '@mono/db';
import { createInAppNotification } from '@mono/api/services';
import {
  DEFAULT_QUIET_HOURS,
  nextSendTime,
  notifyEvent,
  renderText,
  templateCode,
  toNumberedTemplate,
  type QuietHours,
  type TemplateChannel,
} from '@mono/shared';
import { resolveRecipients, type External, type Person } from './recipients';
import { buildVars } from './vars';

export type EngineDeps = {
  db: Db;
  appName: string;
  baseUrl: string;
  onQueued?: () => void;
  /** Channels the company has set up; others are recorded as SKIPPED instead of failing later. */
  available?: (companyId: string) => Promise<Set<string>>;
};

/** Events that must reach people even during quiet hours. */
const URGENT = new Set(['notify.escalation', 'notify.test', 'notify.telegram_code']);
const TELEGRAM_ACTIONS: Record<string, string> = {
  accept: 'Accept',
  done: 'Done',
  verify: 'Verify',
  move: 'Move date',
};

type Tpl = {
  code: string;
  channel: string;
  language: string;
  subject: string | null;
  body: string;
  status: string;
  active: boolean;
};

function quietHoursOf(p: Person): QuietHours {
  const q = (p.prefs as { quietHours?: QuietHours } | null)?.quietHours;
  return q?.start && q?.end ? q : DEFAULT_QUIET_HOURS;
}

/**
 * Domain event → matching rules → recipients → one in-app notification each, plus queued messages per channel.
 * Idempotent per event: if the worker crashes and the event is dispatched again, nothing is sent twice.
 */
export async function notifyForEvent(event: DomainEvent, deps: EngineDeps): Promise<number> {
  const { db } = deps;
  const rules = await db.notificationRule.findMany({
    where: { companyId: event.companyId, event: event.name, active: true, deletedAt: null },
  });
  if (!rules.length) return 0;
  if (await db.outbox.count({ where: { eventId: event.id } })) return 0;
  if (await db.notification.count({ where: { eventId: event.id } })) return 0;

  const company = await db.company.findUniqueOrThrow({ where: { id: event.companyId } });
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const ctx = {
    companyId: company.id,
    companyName: company.name,
    timezone: company.timezone,
    appName: deps.appName,
    baseUrl: deps.baseUrl,
  };
  const vars = await buildVars(db, ctx, payload, event.actorId);
  const def = notifyEvent(event.name);
  const templates = (await db.template.findMany({
    where: { companyId: company.id, event: event.name, deletedAt: null },
  })) as Tpl[];
  const pick = (channel: TemplateChannel, lang: string) => {
    const code = templateCode(event.name, channel);
    const usable = templates.filter(
      (t) => t.code === code && t.active && (channel !== 'whatsapp' || t.status === 'APPROVED'),
    );
    return usable.find((t) => t.language === lang) ?? usable.find((t) => t.language === 'en') ?? null;
  };
  const urgent = URGENT.has(event.name);
  const available = deps.available ? await deps.available(company.id) : null;
  const now = new Date();
  const notified = new Set<string>();
  let queued = 0;
  let firstTelegram: string | null = null;

  await db.$transaction(async (tx) => {
    const queue = async (
      row: Omit<Prisma.OutboxUncheckedCreateInput, 'companyId' | 'eventId' | 'entityType' | 'entityId'>,
    ) => {
      await tx.outbox.create({
        data: {
          ...row,
          companyId: company.id,
          eventId: event.id,
          entityType: event.entityType,
          entityId: event.entityId,
        },
      });
      if (row.status !== 'SKIPPED') queued++;
    };

    for (const rule of rules) {
      const resolved = await resolveRecipients(db, company.id, rule.recipients, payload, event.actorId);
      // Nobody needs a message about what they just did themselves (tests and escalations excepted).
      const people = urgent ? resolved.people : resolved.people.filter((p) => p.id !== event.actorId);
      const external = resolved.external;
      const after = new Date(now.getTime() + rule.waitMinutes * 60_000);

      for (const p of people) {
        const v: Record<string, string> = { ...vars, recipient: p.name };
        const lang = p.lang === 'hi' ? 'hi' : 'en';
        const sendAt = urgent ? after : nextSendTime(after, company.timezone, quietHoursOf(p));
        let notificationId: string | null = null;

        // In-app is always created, once per person per event.
        if (!notified.has(p.id)) {
          notified.add(p.id);
          const n = await createInAppNotification(tx, {
            companyId: company.id,
            userId: p.id,
            title: renderText(def?.title[lang] ?? event.name, v),
            body: def ? renderText(def.body[lang], v) : null,
            link: typeof payload.link === 'string' ? payload.link : null,
            eventId: event.id,
            entityType: event.entityType,
            entityId: event.entityId,
            tone: event.name === 'notify.escalation' ? 'warn' : null,
          });
          notificationId = n.id;
        }

        for (const channel of rule.channels) {
          if (channel === 'inapp') continue;
          if (channel === 'push') {
            const subs = await tx.pushSubscription.findMany({ where: { userId: p.id } });
            for (const s of subs) {
              await queue({
                channel,
                userId: p.id,
                to: s.id,
                ruleId: rule.id,
                sendAfter: sendAt,
                payload: {
                  title: renderText(def?.title[lang] ?? event.name, v),
                  text: def ? renderText(def.body[lang], v) : '',
                  link: v.link,
                },
              });
            }
            continue;
          }
          if (available && !available.has(channel)) {
            await queue({
              channel,
              userId: p.id,
              to: '-',
              ruleId: rule.id,
              status: 'SKIPPED',
              lastError: `${channel} is not set up`,
              payload: {},
            });
            continue;
          }
          const tpl = pick(channel as TemplateChannel, lang);
          const to = channel === 'telegram' ? p.telegramChatId : channel === 'email' ? p.email : p.mobile;
          const skip = !to
            ? `${p.name} has no ${channel === 'telegram' ? 'linked Telegram' : channel === 'email' ? 'email' : 'mobile number'}`
            : !tpl
              ? `No active${channel === 'whatsapp' ? ', approved' : ''} ${channel} template`
              : null;
          if (skip) {
            await queue({
              channel,
              userId: p.id,
              to: to ?? '-',
              ruleId: rule.id,
              status: 'SKIPPED',
              lastError: skip,
              payload: {},
            });
            continue;
          }
          const body = renderText(tpl!.body, v);
          const message: Record<string, unknown> = { text: body, link: v.link };
          if (channel === 'email')
            message.subject = renderText(tpl!.subject ?? def?.title[lang] ?? deps.appName, v);
          if (channel === 'whatsapp') {
            const numbered = toNumberedTemplate(tpl!.body);
            message.waTemplate = tpl!.code;
            message.waLanguage = tpl!.language;
            message.waParams = numbered.names.map((name, i) => ({
              name: String(i + 1),
              value: v[name] ?? '—',
            }));
          }
          if (channel === 'telegram') {
            const actions = Array.isArray(payload.telegramActions)
              ? (payload.telegramActions as string[])
              : [];
            const buttons: { label: string; data?: string; url?: string }[] = actions
              .filter((a) => TELEGRAM_ACTIONS[a])
              .map((a) => ({
                label: TELEGRAM_ACTIONS[a]!,
                data: `act:${a}:${event.entityType}:${event.entityId}`,
              }));
            if (notificationId) buttons.push({ label: 'Seen ✓', data: `ack:${notificationId}` });
            if (v.link?.startsWith('https://')) buttons.push({ label: 'Open', url: v.link });
            message.buttons = buttons;
            firstTelegram ??= body;
          }
          await queue({
            channel,
            userId: p.id,
            to: to!,
            templateCode: tpl!.code,
            ruleId: rule.id,
            sendAfter: sendAt,
            payload: message as Prisma.InputJsonValue,
          });
        }

        if (rule.escalateTo && rule.escalateAfterMinutes) {
          await tx.escalation.create({
            data: {
              companyId: company.id,
              ruleId: rule.id,
              eventId: event.id,
              entityType: event.entityType,
              entityId: event.entityId,
              userId: p.id,
              dueAt: new Date(after.getTime() + rule.escalateAfterMinutes * 60_000),
            },
          });
        }
      }

      for (const ext of external) await queueExternal(ext, rule, vars, pick, queue, after);
    }

    // Admin group gets one copy of each Telegram message.
    const tg = await tx.channelConfig.findFirst({ where: { companyId: company.id, channel: 'telegram' } });
    const group = (tg?.meta as { groupChatId?: string } | null)?.groupChatId;
    if (group && firstTelegram)
      await queue({ channel: 'telegram', to: group, payload: { text: firstTelegram } });
  });

  if (queued) deps.onQueued?.();
  return queued;
}

/** Customers and vendors get WhatsApp/email only, sent right away (no quiet-hours profile). */
async function queueExternal(
  ext: External,
  rule: { id: string; channels: string[] },
  vars: Record<string, string>,
  pick: (c: TemplateChannel, lang: string) => Tpl | null,
  queue: (
    row: Omit<Prisma.OutboxUncheckedCreateInput, 'companyId' | 'eventId' | 'entityType' | 'entityId'>,
  ) => Promise<void>,
  sendAt: Date,
) {
  const v: Record<string, string> = { ...vars, recipient: ext.name ?? '' };
  for (const channel of rule.channels) {
    if (channel !== 'whatsapp' && channel !== 'email') continue;
    const to = channel === 'email' ? ext.email : ext.mobile;
    const tpl = pick(channel, 'en');
    if (!to || !tpl) continue;
    const msg: Record<string, unknown> = { text: renderText(tpl.body, v), link: v.link };
    if (channel === 'email') msg.subject = renderText(tpl.subject ?? '', v);
    if (channel === 'whatsapp') {
      const numbered = toNumberedTemplate(tpl.body);
      Object.assign(msg, {
        waTemplate: tpl.code,
        waLanguage: tpl.language,
        waParams: numbered.names.map((n, i) => ({ name: String(i + 1), value: v[n] ?? '—' })),
      });
    }
    await queue({
      channel,
      to,
      templateCode: tpl.code,
      ruleId: rule.id,
      sendAfter: sendAt,
      payload: msg as Prisma.InputJsonValue,
    });
  }
}
