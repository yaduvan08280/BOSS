import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** One browser: a lock and a store shared by its tabs, and a server that takes 30 ms to renew. */
function browser() {
  let tail: Promise<unknown> = Promise.resolve();
  const store = new Map<string, string>();
  const calls: number[] = [];
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, fn: () => Promise<unknown>) => {
        const mine = tail.then(fn);
        tail = mine.catch(() => undefined);
        return mine;
      },
    },
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal('fetch', async () => {
    calls.push(Date.now());
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true };
  });
  return calls;
}

/** A tab is its own copy of the module: its own "one at a time" promise. */
async function tab() {
  vi.resetModules();
  return (await import('./refresh')).refreshSession;
}

describe('renewing the sign-in', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it('two tabs asking at the same moment renew once between them', async () => {
    const calls = browser();
    const [one, two] = [await tab(), await tab()];
    const got = await Promise.all([one(), two(), one()]);
    expect(got).toEqual([true, true, true]);
    expect(calls).toHaveLength(1);
  });

  it('a later expiry renews again', async () => {
    const calls = browser();
    const one = await tab();
    await one();
    await new Promise((r) => setTimeout(r, 5));
    await one();
    expect(calls).toHaveLength(2);
  });

  it('works where the browser has neither locks nor storage', async () => {
    const calls = browser();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const one = await tab();
    expect(await one()).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('a refused renewal is false and leaves no mark for the other tabs', async () => {
    browser();
    vi.stubGlobal('fetch', async () => ({ ok: false }));
    const [one, two] = [await tab(), await tab()];
    expect(await Promise.all([one(), two()])).toEqual([false, false]);
  });
});
