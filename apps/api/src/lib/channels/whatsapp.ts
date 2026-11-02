import { ChannelError, type Fetch, type OutgoingMessage, type SendResult } from './types';

/**
 * WhatsApp Business through a provider. Each provider sends approved templates only.
 * WATI and AiSensy are implemented; Interakt and Kit19 can be added behind the same interface.
 */
export type WhatsAppConfig = {
  provider: string;
  endpoint?: string;
  apiKey: string;
  displayName?: string;
  number?: string;
};
export type TemplateStatus = {
  name: string;
  status: string;
  category?: string;
  language?: string;
  quality?: string;
};

export interface WhatsAppProvider {
  name: string;
  send(to: string, msg: OutgoingMessage): Promise<SendResult>;
  /** Approval status of every template the provider knows, or null if the provider has no API for it. */
  templateStatuses(): Promise<TemplateStatus[] | null>;
  /** Quick credentials check for the "Test API" button. */
  test(): Promise<string>;
}

const digits = (to: string) => to.replace(/\D/g, '');

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

/** WATI: https://docs.wati.io — Bearer token, endpoint like https://live-server-12345.wati.io */
function wati(cfg: WhatsAppConfig, f: Fetch): WhatsAppProvider {
  if (!cfg.endpoint) throw new ChannelError('WhatsApp: WATI needs the API endpoint', false);
  const base = cfg.endpoint.replace(/\/+$/, '');
  const headers = {
    Authorization: cfg.apiKey.startsWith('Bearer ') ? cfg.apiKey : `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };
  return {
    name: 'wati',
    async send(to, msg) {
      if (!msg.waTemplate) throw new ChannelError('WhatsApp: no approved template for this message', false);
      const res = await f(`${base}/api/v1/sendTemplateMessage?whatsappNumber=${digits(to)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          template_name: msg.waTemplate,
          broadcast_name: msg.waTemplate,
          parameters: msg.waParams ?? [],
        }),
      });
      const body = await json(res);
      if (!res.ok || body.result === false) {
        throw new ChannelError(
          `WhatsApp (WATI): ${String(body.info ?? body.message ?? body.raw ?? res.status)}`,
          res.status >= 500 || res.status === 429,
        );
      }
      return { providerId: typeof body.id === 'string' ? body.id : null };
    },
    async templateStatuses() {
      const res = await f(`${base}/api/v1/getMessageTemplates`, { headers });
      const body = await json(res);
      if (!res.ok) throw new ChannelError(`WhatsApp (WATI): HTTP ${res.status}`);
      const list = (body.messageTemplates ?? []) as Record<string, unknown>[];
      return list.map((t) => ({
        name: String(t.elementName ?? t.name ?? ''),
        status: String(t.status ?? 'PENDING').toUpperCase(),
        category: t.category ? String(t.category) : undefined,
        language:
          typeof t.language === 'object' && t.language
            ? String((t.language as { value?: string }).value ?? '')
            : undefined,
        quality: t.quality ? String(t.quality) : undefined,
      }));
    },
    async test() {
      const list = await this.templateStatuses();
      return `Connected. ${list?.length ?? 0} templates found.`;
    },
  };
}

/** AiSensy campaign API: each approved template is used through an "API campaign" of the same name. */
function aisensy(cfg: WhatsAppConfig, f: Fetch): WhatsAppProvider {
  const url = (cfg.endpoint ?? 'https://backend.aisensy.com').replace(/\/+$/, '') + '/campaign/t1/api/v2';
  return {
    name: 'aisensy',
    async send(to, msg) {
      if (!msg.waTemplate) throw new ChannelError('WhatsApp: no approved template for this message', false);
      const res = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: cfg.apiKey,
          campaignName: msg.waTemplate,
          destination: digits(to),
          userName: cfg.displayName ?? 'MONO',
          templateParams: (msg.waParams ?? []).map((p) => p.value),
        }),
      });
      const body = await json(res);
      if (!res.ok)
        throw new ChannelError(
          `WhatsApp (AiSensy): ${String(body.message ?? body.raw ?? res.status)}`,
          res.status >= 500 || res.status === 429,
        );
      return { providerId: typeof body.submitted_message_id === 'string' ? body.submitted_message_id : null };
    },
    // AiSensy shows approval status in its dashboard; there is no public API for it.
    async templateStatuses() {
      return null;
    },
    async test() {
      if (cfg.apiKey.length < 20)
        throw new ChannelError('WhatsApp (AiSensy): the API key looks too short', false);
      return 'Key saved. AiSensy has no test call: send a test message to check it.';
    },
  };
}

export function whatsappProvider(cfg: WhatsAppConfig, f: Fetch = fetch): WhatsAppProvider {
  if (cfg.provider === 'wati') return wati(cfg, f);
  if (cfg.provider === 'aisensy') return aisensy(cfg, f);
  throw new ChannelError(`WhatsApp: ${cfg.provider} is not supported yet; use WATI or AiSensy`, false);
}
