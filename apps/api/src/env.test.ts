import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromProjectRoot } from './env';

describe('paths in .env', () => {
  it('a relative upload folder is the same for the api and the worker, wherever each starts', () => {
    const root = resolve(__dirname, '../../..');
    const fromApi = fromProjectRoot('./data/uploads', resolve(root, 'apps/api'));
    const fromWorker = fromProjectRoot('./data/uploads', resolve(root, 'apps/worker/src'));
    expect(fromApi).toBe(resolve(root, 'data/uploads'));
    expect(fromWorker).toBe(fromApi);
    expect(fromProjectRoot('/data/uploads', resolve(root, 'apps/api'))).toBe('/data/uploads');
  });
});
