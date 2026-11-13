import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const sign = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url');

/** A small sum ("4 + 7") signed with the server secret, valid 30 minutes: no cookies, no third party (decision 55). */
export function challenge(secret: string) {
  const a = randomInt(1, 10);
  const b = randomInt(1, 10);
  const expires = Date.now() + 30 * 60_000;
  return { question: `${a} + ${b}`, token: `${expires}.${sign(secret, `${a + b}:${expires}`)}` };
}

export function checkChallenge(secret: string, token: string, answer: number) {
  const [expires, mac] = token.split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  const want = Buffer.from(sign(secret, `${answer}:${expires}`));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}
