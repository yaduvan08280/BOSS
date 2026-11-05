/**
 * Browser errors go to the server (System Master → Errors). Each kind is sent once per page load, at most 10,
 * and never about the reporting itself. A signed-out page simply gets a 401 back, which is ignored.
 */
const sent = new Set<string>();

export function reportError(err: unknown) {
  const e =
    err instanceof Error
      ? err
      : new Error(typeof err === 'string' ? err : JSON.stringify(err ?? 'Unknown error'));
  const key = `${e.message}|${(e.stack ?? '').split('\n')[1] ?? ''}`;
  if (
    sent.has(key) ||
    sent.size >= 10 ||
    /ResizeObserver loop|Failed to fetch dynamically imported module/.test(e.message)
  )
    return;
  sent.add(key);
  void fetch('/api/errors', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: e.message.slice(0, 1000),
      stack: e.stack?.slice(0, 8000) ?? null,
      path: location.pathname.slice(0, 300),
    }),
    keepalive: true,
  }).catch(() => undefined);
}

export function watchErrors() {
  window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason));
}
