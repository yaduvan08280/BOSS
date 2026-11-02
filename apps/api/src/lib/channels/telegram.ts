import { ChannelError, type Fetch, type OutgoingMessage, type SendResult } from './types';

const API = 'https://api.telegram.org';

type TgResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number };

async function call<T>(token: string, method: string, body: unknown, f: Fetch = fetch): Promise<T> {
  const res = await f(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res
    .json()
    .catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgResponse<T>;
  if (!json.ok) {
    // 400/403 (chat not found, bot blocked) won't fix themselves; 429/5xx will.
    const permanent = json.error_code === 400 || json.error_code === 403 || json.error_code === 401;
    throw new ChannelError(`Telegram: ${json.description ?? 'request failed'}`, !permanent);
  }
  return json.result as T;
}

export async function telegramGetMe(token: string, f?: Fetch) {
  return call<{ id: number; username: string; first_name: string }>(token, 'getMe', {}, f);
}

export async function sendTelegram(
  token: string,
  chatId: string,
  msg: OutgoingMessage,
  f?: Fetch,
): Promise<SendResult> {
  const keyboard = msg.buttons?.length
    ? {
        inline_keyboard: [
          msg.buttons.map((b) =>
            b.url ? { text: b.label, url: b.url } : { text: b.label, callback_data: b.data ?? 'noop' },
          ),
        ],
      }
    : undefined;
  const result = await call<{ message_id: number }>(
    token,
    'sendMessage',
    {
      chat_id: chatId,
      text: msg.text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    },
    f,
  );
  return { providerId: `${chatId}:${result.message_id}` };
}
