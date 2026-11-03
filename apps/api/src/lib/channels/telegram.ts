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

/** multipart/form-data call, for uploading photos and documents. */
async function upload<T>(token: string, method: string, form: FormData, f: Fetch = fetch): Promise<T> {
  const res = await f(`${API}/bot${token}/${method}`, { method: 'POST', body: form });
  const json = (await res
    .json()
    .catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgResponse<T>;
  if (!json.ok) {
    const permanent = json.error_code === 400 || json.error_code === 403 || json.error_code === 401;
    throw new ChannelError(`Telegram: ${json.description ?? 'upload failed'}`, !permanent);
  }
  return json.result as T;
}

export type ReadFile = (path: string) => Promise<Buffer>;

/**
 * Send a message; with proof files, the files go first so the verifier sees them before the buttons:
 * one photo → that photo with the text and buttons as its caption; more → an album, then the text.
 * A file that can't be read never blocks the message: the text says to open the app instead.
 */
export async function sendTelegram(
  token: string,
  chatId: string,
  msg: OutgoingMessage,
  f?: Fetch,
  readFile?: ReadFile,
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
  let text = msg.text;
  const files: { name: string; mime: string; data: Buffer }[] = [];
  if (msg.files?.length && readFile) {
    for (const file of msg.files.slice(0, 10)) {
      try {
        files.push({ name: file.name, mime: file.mime, data: await readFile(file.path) });
      } catch {
        text += '\n\n⚠️ A proof file could not be attached — open the app to see it.';
      }
    }
  } else if (msg.files?.length)
    text += `\n\n📎 ${msg.files.length} file(s) attached — open the app to see them.`;

  const blob = (x: (typeof files)[number]) => new Blob([new Uint8Array(x.data)], { type: x.mime });
  const photos = files.filter((x) => x.mime.startsWith('image/'));
  const docs = files.filter((x) => !x.mime.startsWith('image/'));

  if (photos.length === 1 && !docs.length && text.length <= 1000) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', text);
    form.set('parse_mode', 'HTML');
    if (keyboard) form.set('reply_markup', JSON.stringify(keyboard));
    form.set('photo', blob(photos[0]!), photos[0]!.name);
    const r = await upload<{ message_id: number }>(token, 'sendPhoto', form, f);
    return { providerId: `${chatId}:${r.message_id}` };
  }
  if (photos.length > 1) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('media', JSON.stringify(photos.map((_, i) => ({ type: 'photo', media: `attach://p${i}` }))));
    photos.forEach((p, i) => form.set(`p${i}`, blob(p), p.name));
    await upload(token, 'sendMediaGroup', form, f);
  } else if (photos.length === 1) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('photo', blob(photos[0]!), photos[0]!.name);
    await upload(token, 'sendPhoto', form, f);
  }
  for (const d of docs) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('document', blob(d), d.name);
    await upload(token, 'sendDocument', form, f);
  }
  const result = await call<{ message_id: number }>(
    token,
    'sendMessage',
    {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    },
    f,
  );
  return { providerId: `${chatId}:${result.message_id}` };
}
