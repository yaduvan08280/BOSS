import { NOTIFY_EVENTS, RULES_OFF_BY_DEFAULT, type NotifyEvent, type TemplateChannel } from './catalog';

const VAR = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

/** Names used in a template, in order of first appearance. */
export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR)].map((m) => m[1]!))];
}

/** Fill {{name}} placeholders. Missing values become "—" so a message never shows raw braces. */
export function renderText(text: string, vars: Record<string, unknown>): string {
  return text.replace(VAR, (_, name: string) => {
    const v = vars[name];
    return v === undefined || v === null || v === '' ? '—' : String(v);
  });
}

/** WhatsApp templates use numbered placeholders: "Hi {{doer}}" → "Hi {{1}}" + ["doer"]. */
export function toNumberedTemplate(text: string): { text: string; names: string[] } {
  const names = templateVariables(text);
  return { text: text.replace(VAR, (_, name: string) => `{{${names.indexOf(name) + 1}}}`), names };
}

/** Telegram HTML needs <, > and & escaped in the variable parts. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type DefaultTemplate = {
  code: string;
  channel: TemplateChannel;
  event: string;
  category: 'UTILITY';
  language: 'en' | 'hi';
  subject: string | null;
  body: string;
  status: 'APPROVED' | 'DRAFT';
};

export function templateCode(event: string, channel: TemplateChannel): string {
  const suffix = { whatsapp: 'wa', email: 'email', telegram: 'tg' }[channel];
  return `${event.replace(/\./g, '_')}_${suffix}`;
}

function defaultsFor(e: NotifyEvent, channel: TemplateChannel, language: 'en' | 'hi'): DefaultTemplate {
  const title = e.title[language];
  const body = e.body[language];
  const text =
    channel === 'telegram'
      ? `<b>${title}</b>\n${body}`
      : channel === 'email'
        ? `${body}\n\n{{link}}`
        : `*${title}*\n${body}`;
  return {
    code: templateCode(e.event, channel),
    channel,
    event: e.event,
    category: 'UTILITY',
    language,
    subject: channel === 'email' ? title : null,
    body: text,
    // WhatsApp templates must be approved by the provider before they can be used.
    status: channel === 'whatsapp' ? 'DRAFT' : 'APPROVED',
  };
}

/** The built-in set: every event × WhatsApp/Email/Telegram × English/Hindi. */
export function defaultTemplates(
  channels: readonly TemplateChannel[] = ['whatsapp', 'email', 'telegram'],
): DefaultTemplate[] {
  return NOTIFY_EVENTS.flatMap((e) =>
    channels.flatMap((c) => (['en', 'hi'] as const).map((l) => defaultsFor(e, c, l))),
  );
}

export type DefaultRule = {
  event: string;
  audience: string;
  recipients: string[];
  channels: string[];
  active: boolean;
};

export function defaultRules(): DefaultRule[] {
  return NOTIFY_EVENTS.map((e) => ({
    event: e.event,
    audience: e.audience,
    recipients: e.to,
    active: !RULES_OFF_BY_DEFAULT.includes(e.event),
    channels:
      e.event === 'notify.test'
        ? ['telegram', 'email', 'whatsapp', 'inapp', 'push']
        : e.event === 'notify.telegram_code'
          ? ['whatsapp', 'email', 'inapp']
          : e.event === 'notify.escalation'
            ? ['telegram', 'inapp', 'push', 'email']
            : e.audience === 'team'
              ? ['telegram', 'inapp', 'push']
              : ['whatsapp', 'email'],
  }));
}

export const DEFAULT_REMINDER_PATTERNS = [
  {
    name: 'Standard',
    remindAt: ['day_before', 'h1_before', 'at_due'],
    channels: ['telegram', 'inapp'],
    overdueRepeat: 'morning',
    isDefault: true,
  },
  { name: 'Gentle', remindAt: ['at_due'], channels: ['inapp'], overdueRepeat: 'none', isDefault: false },
  {
    name: 'Strict',
    remindAt: ['h3_before', 'h1_before', 'at_due', 'h1_after'],
    channels: ['telegram', 'whatsapp', 'inapp'],
    overdueRepeat: 'hourly',
    isDefault: false,
  },
];
