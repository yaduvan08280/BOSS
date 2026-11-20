/**
 * Renewing the sign-in. Every tab of one browser holds the same cookies, so only one may renew at a time:
 * a laptop waking up, or the server coming back after an update, makes every tab ask at the same moment,
 * and the server answers a renewal only once per token. The tabs take turns (Web Locks); a tab whose turn
 * comes after another tab's renewal does not ask again — the cookies it needs are already there.
 */
const LOCK = 'mono-refresh';
const STAMP = 'mono.refreshedAt';

const readStamp = (): number => {
  try {
    return Number(localStorage.getItem(STAMP)) || 0;
  } catch {
    return 0;
  }
};

const writeStamp = () => {
  try {
    localStorage.setItem(STAMP, String(Date.now()));
  } catch {
    /* private window: the turn-taking alone still holds */
  }
};

async function renew(askedAt: number): Promise<boolean> {
  if (readStamp() >= askedAt) return true; // another tab renewed while this one waited its turn
  const ok = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false);
  if (ok) writeStamp();
  return ok;
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit a 401 together — in this tab and the others. */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  const askedAt = Date.now();
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  const run: Promise<boolean> = locks
    ? locks.request(LOCK, () => renew(askedAt)).catch(() => false)
    : renew(askedAt);
  refreshing = run.finally(() => {
    refreshing = null;
  });
  return refreshing;
}
