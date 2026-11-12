import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import enBase from './en.json';
import hiBase from './hi.json';

/** The main files plus every feature file in ./parts (the same merge the app does at start-up). */
const partsDir = join(import.meta.dirname, 'parts');
const parts = (lang: string) =>
  readdirSync(partsDir)
    .filter((f) => f.endsWith(`.${lang}.json`))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(partsDir, f), 'utf8')) as Record<string, unknown>);
const en: Record<string, unknown> = Object.assign({}, enBase, ...parts('en'));
const hi: Record<string, unknown> = Object.assign({}, hiBase, ...parts('hi'));

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('translations', () => {
  it('feature files add new sections and never replace one', () => {
    for (const lang of ['en', 'hi'] as const) {
      const seen = new Set(Object.keys(lang === 'en' ? enBase : hiBase));
      for (const part of parts(lang))
        for (const section of Object.keys(part)) {
          expect(seen.has(section), `${lang}: section "${section}" is defined twice`).toBe(false);
          seen.add(section);
        }
    }
  });
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
