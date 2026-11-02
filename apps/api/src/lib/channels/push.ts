import webpush from 'web-push';
import { ChannelError, type OutgoingMessage, type SendResult } from './types';

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export function generateVapidKeys() {
  return webpush.generateVAPIDKeys();
}

export async function sendPush(
  keys: VapidKeys,
  target: PushTarget,
  msg: OutgoingMessage,
): Promise<SendResult> {
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify({ title: msg.title ?? msg.subject ?? 'MONO', body: msg.text, url: msg.link ?? '/' }),
      { vapidDetails: keys, TTL: 60 * 60 * 24 },
    );
    return {};
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404/410: the subscription is gone (app uninstalled or permission removed).
    throw new ChannelError(`Push: ${(err as Error).message}`, !(status === 404 || status === 410));
  }
}
