/**
 * Whatever was thrown or emitted, as an Error with words in it. The queue hands over plain objects
 * (`{ message, stack, queue, … }`), and `String()` of one is "[object Object]" — which is what System
 * Master → Errors then showed.
 */
export function errorOf(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; stack?: unknown; queue?: unknown };
    const said = typeof o.message === 'string' && o.message ? o.message : safeJson(err);
    const e = new Error(typeof o.queue === 'string' ? `${said} (queue ${o.queue})` : said);
    if (typeof o.stack === 'string') e.stack = o.stack;
    return e;
  }
  return new Error(String(err));
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return 'An error that could not be read';
  }
}
