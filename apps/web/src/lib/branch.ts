import { safeStorage } from './utils';

/**
 * The branch the top bar's switcher shows (phase 12). Empty = "All my branches". Every API call carries it in
 * `x-mono-branch`; the server only ever narrows what the person may already see.
 */
const KEY = 'mono.branch';

export const currentBranch = (): string => safeStorage.get(KEY) ?? '';

export function setCurrentBranch(id: string) {
  // An empty value means "all my branches".
  safeStorage.set(KEY, id);
}

export const branchHeader = (): Record<string, string> => {
  const id = currentBranch();
  return id ? { 'x-mono-branch': id } : {};
};
