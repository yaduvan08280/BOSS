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
});
