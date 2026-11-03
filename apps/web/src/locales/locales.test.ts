import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import hi from './hi.json';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('translations', () => {
  it('Hindi has exactly the same keys as English', () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort());
  });
  it('keeps the same {{placeholders}} in every string', () => {
    const vars = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(',');
    const flat = (o: object, p = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' && v ? flat(v, `${p}${k}.`) : [[`${p}${k}`, String(v)]],
      );
    const hiMap = new Map(flat(hi));
    for (const [k, v] of flat(en)) expect(vars(hiMap.get(k) ?? ''), k).toBe(vars(v));
  });
  it('has every key the screens ask for (no raw "common.edit" on a button)', () => {
    const src = join(import.meta.dirname, '..');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) return files(p);
        return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
      });
    const have = new Set(keys(en));
    const node = (k: string) =>
      k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], en);
    const missing: string[] = [];
    let seen = 0;
    for (const file of files(src))
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z][\w.]*\.[\w]+)'/g)) {
        const k = m[1]!;
        seen++;
        // Plain key, a plural (_one/_other), or a list / group read with returnObjects.
        if (have.has(k) || have.has(`${k}_one`) || (node(k) && typeof node(k) === 'object')) continue;
        missing.push(`${k} (${file.slice(src.length + 1)})`);
      }
    expect(seen, 'the scan found the screens').toBeGreaterThan(500);
    expect(missing).toEqual([]);
  });
});
