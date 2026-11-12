import type { ApiError as ApiErrorBody } from '@mono/shared';
import { branchHeader } from './branch';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit a 401 together. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; retry?: boolean };

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { body, retry = true, headers, ...rest } = opts;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...branchHeader(),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (
    res.status === 401 &&
    retry &&
    !path.startsWith('/api/auth/login') &&
    !path.startsWith('/api/auth/refresh')
  ) {
    if (await refreshSession()) return api<T>(path, { ...opts, retry: false });
  }
  if (!res.ok) {
    let payload: ApiErrorBody | null = null;
    try {
      payload = (await res.json()) as ApiErrorBody;
    } catch {
      /* not JSON */
    }
    throw new ApiError(
      res.status,
      payload?.error.code ?? 'INTERNAL',
      payload?.error.message ?? 'Something went wrong',
      payload?.error.details,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
