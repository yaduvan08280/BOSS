import { safeStorage } from './utils';

/**
 * Shadow mode: while an Owner looks at MONO as one of their people, every API call carries that person's id in
 * `x-mono-view-as`. The server answers as that person and refuses anything that would change data.
 */
const KEY = 'mono.viewAs';
export type ViewAs = { id: string; name: string };

export function currentViewAs(): ViewAs | null {
  try {
    const v = JSON.parse(safeStorage.get(KEY) ?? 'null') as ViewAs | null;
    return v?.id ? v : null;
  } catch {
    return null;
  }
}
export function setViewAs(v: ViewAs | null) {
  safeStorage.set(KEY, v ? JSON.stringify(v) : '');
}
export const viewAsHeader = (): Record<string, string> => {
  const v = currentViewAs();
  return v ? { 'x-mono-view-as': v.id } : {};
};

/** Leave shadow mode and load the app again as yourself. */
export function leaveShadow() {
  setViewAs(null);
  window.location.assign('/');
}

/** Start looking at MONO as a person (Owner only; written in the audit log), then load the app as them. */
export async function lookAs(userId: string) {
  const res = await fetch('/api/owner/view-as', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error('Could not open that view');
  setViewAs((await res.json()) as ViewAs);
  window.location.assign('/');
}
