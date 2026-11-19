import { describe, expect, it } from 'vitest';
import { errorOf } from './error-of';

describe('errorOf()', () => {
  it('keeps an Error as it is', () => {
    const e = new Error('boom');
    expect(errorOf(e)).toBe(e);
  });
  it('reads the words out of what the queue emits (a plain object), never "[object Object]"', () => {
    const e = errorOf({
      message: 'relation "pgboss.queue" does not exist',
      stack: 'at x',
      queue: 'work.every5min',
    });
    expect(e.message).toBe('relation "pgboss.queue" does not exist (queue work.every5min)');
    expect(e.stack).toBe('at x');
    expect(errorOf({ code: 42 }).message).toBe('{"code":42}');
    expect(errorOf('plain words').message).toBe('plain words');
    expect(errorOf(undefined).message).toBe('undefined');
    for (const odd of [{ message: '' }, { a: { b: 1 } }, null, 7])
      expect(errorOf(odd).message).not.toContain('[object');
  });
});
