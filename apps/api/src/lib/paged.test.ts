import { describe, expect, it } from 'vitest';
import { afterId, paged } from './paged';

/** A table of rows with ids, read the way a job's `findMany` would be. */
function table(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}` }));
  const calls: (string | undefined)[] = [];
  const fetch = async (after: string | undefined, take: number) => {
    calls.push(after);
    const cond = afterId(after) as { id?: { gt: string } };
    return rows.filter((r) => !cond.id || r.id > cond.id.gt).slice(0, take);
  };
  return { rows, calls, fetch };
}

describe('paged', () => {
  it('reaches every row, also those after the first page', async () => {
    const t = table(1203);
    const seen: string[] = [];
    for await (const r of paged(t.fetch, 500)) seen.push(r.id);
    expect(seen).toEqual(t.rows.map((r) => r.id));
    expect(t.calls).toEqual([undefined, 'r00499', 'r00999']);
  });

  it('asks once more when the last page was full, and stops on an empty one', async () => {
    const t = table(1000);
    let n = 0;
    for await (const _ of paged(t.fetch, 500)) n++;
    expect(n).toBe(1000);
    expect(t.calls).toHaveLength(3);
  });

  it('does nothing with no rows', async () => {
    const t = table(0);
    let n = 0;
    for await (const _ of paged(t.fetch, 500)) n++;
    expect(n).toBe(0);
    expect(t.calls).toEqual([undefined]);
  });
});
