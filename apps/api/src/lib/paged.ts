/**
 * Every row a background job should look at, a page at a time, in id order.
 *
 * A job that reads a fixed "first N" rows with no order never reaches the rows after them once more than N
 * match and stay matching (an overdue task stays overdue) — their reminders would never be sent. `fetch` must
 * add `id > after` to its filter when `after` is given, order by id ascending and take `take` rows.
 */
export async function* paged<T extends { id: string }>(
  fetch: (after: string | undefined, take: number) => Promise<T[]>,
  size = 500,
): AsyncGenerator<T> {
  for (let after: string | undefined; ;) {
    const page = await fetch(after, size);
    yield* page;
    if (page.length < size) return;
    after = page.at(-1)!.id;
  }
}

/** The filter part for `paged`: rows after the last one seen. */
export const afterId = (after: string | undefined) => (after ? { id: { gt: after } } : {});
