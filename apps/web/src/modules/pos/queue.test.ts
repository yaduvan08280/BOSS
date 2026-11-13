import { describe, expect, it } from 'vitest';
import { drain, enqueue, newKey, type Queued, type SendResult } from './queue';

describe('the POS offline queue (P33)', () => {
  const three = () =>
    ['a', 'b', 'c'].reduce<Queued[]>((q, x, i) => enqueue(q, `/api/pos/${x}`, { n: i }, i), []);

  it('sends in order and empties when the server answers', async () => {
    const seen: string[] = [];
    const r = await drain(three(), async (q) => {
      seen.push(q.url);
      return 'sent';
    });
    expect([seen, r.left, r.sent]).toEqual([['/api/pos/a', '/api/pos/b', '/api/pos/c'], [], 3]);
  });

  it('stops at the first request that can’t reach the server and keeps the rest, in order', async () => {
    const answers: SendResult[] = ['sent', 'offline', 'sent'];
    let i = 0;
    const r = await drain(three(), async () => answers[i++]!);
    expect([r.sent, r.left.map((q) => q.url), i]).toEqual([1, ['/api/pos/b', '/api/pos/c'], 2]);
    // The link is back: the rest goes, starting where it stopped.
    const again = await drain(r.left, async () => 'sent');
    expect([again.sent, again.left]).toEqual([2, []]);
  });

  it('drops a request the server refuses and reports it, and goes on with the next', async () => {
    const r = await drain(three(), async (q) =>
      q.url.endsWith('b') ? { refused: 'That table already has an order running' } : 'sent',
    );
    expect([r.sent, r.left, r.refused.map((x) => [x.request.url, x.why])]).toEqual([
      2,
      [],
      [['/api/pos/b', 'That table already has an order running']],
    ]);
  });

  it('makes a different key every time', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newKey()));
    expect(keys.size).toBe(200);
    expect([...keys][0]!.length).toBeGreaterThanOrEqual(8);
  });
});
