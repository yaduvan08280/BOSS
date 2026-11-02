import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/** S3-like object storage. Local disk now; a Drive/S3 implementation can replace it later. */
export interface Storage {
  put(key: string, body: Readable): Promise<number>;
  get(key: string): Readable;
  remove(key: string): Promise<void>;
}

export class LocalDiskStorage implements Storage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Readable): Promise<number> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await pipeline(body, createWriteStream(full, { flags: 'wx' }));
    return (await stat(full)).size;
  }

  get(key: string): Readable {
    return createReadStream(this.path(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
