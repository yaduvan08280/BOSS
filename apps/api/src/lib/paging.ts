/**
 * Sweeps whose rows stay in the selected set after being handled (still overdue, still waiting, still open)
 * must look at every row, a page at a time: a fixed "first N" with no order would leave the rest unseen for good.
 * `fetch` returns rows with `id > after` ordered by id ascending, at most `size` of them.
 */
export async function forEachPage<T extends { id: string }>(
  fetch: (after: string | undefined, take: number) => Promise<T[]>,
  handle: (page: T[]) => Promise<void>,
  size = 500,
): Promise<void> {
  for (let after: string | undefined; ;) {
    const page = await fetch(after, size);
    if (!page.length) return;
    await handle(page);
    if (page.length < size) return;
    after = page.at(-1)!.id;
  }
}

/** `where` part for the next page: rows after the cursor. */
export const afterId = (after: string | undefined) => (after ? { id: { gt: after } } : {});
