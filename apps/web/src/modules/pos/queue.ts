/**
 * Phase 15 — the device's offline queue. What a steward does while the server can't be reached (open an order,
 * add and fire lines) is kept on the device and sent in order when it answers again. Every request carries a key
 * made here, so one that was sent twice is made once on the server.
 */
export type Queued = { id: string; url: string; body: unknown; at: number };
export type SendResult = 'sent' | 'offline' | { refused: string };

const KEY = 'mono.pos.queue';
export const newKey = (prefix = 'dev') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const enqueue = (queue: Queued[], url: string, body: unknown, now = Date.now()): Queued[] => [
  ...queue,
  { id: newKey('q'), url, body, at: now },
];

/**
 * Send the queue in order. A request the server takes or refuses (a table already taken, a closed day) leaves
 * the queue — a refusal is reported, not retried for ever. The first one that can't reach the server stops the
 * run: it and everything after it wait, in order.
 */
export async function drain(
  queue: Queued[],
  send: (q: Queued) => Promise<SendResult>,
): Promise<{ left: Queued[]; sent: number; refused: { request: Queued; why: string }[] }> {
  const refused: { request: Queued; why: string }[] = [];
  let sent = 0;
  for (const [i, q] of queue.entries()) {
    const r = await send(q);
    if (r === 'offline') return { left: queue.slice(i), sent, refused };
    if (r === 'sent') sent += 1;
    else refused.push({ request: q, why: r.refused });
  }
  return { left: [], sent, refused };
}

export function loadQueue(): Queued[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Queued[]) : [];
  } catch {
    return [];
  }
}
export function saveQueue(queue: Queued[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // A full or blocked store: the queue lives for this page only.
  }
}
