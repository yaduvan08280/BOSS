import { describe, expect, it } from 'vitest';
import { contrast, hexToOklch, oklchToHex } from './color';
import {
  DEFAULT_THEME,
  generateTheme,
  SEED_POOL,
  seedClashesWithStatus,
  type ThemeOptions,
} from './generate';

const pairs: [string, string, number][] = [
  ['foreground', 'background', 7],
  ['foreground', 'card', 7],
  ['muted-foreground', 'card', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['accent-soft-foreground', 'accent-soft', 4.5],
  ['sidebar-foreground', 'sidebar', 4.5],
  ['sidebar-active-foreground', 'sidebar-active', 4.5],
  ['ink-foreground', 'ink', 7],
  ['status-bad-fg', 'status-bad-bg', 4.5],
  ['status-warn-fg', 'status-warn-bg', 4.5],
  ['status-ok-fg', 'status-ok-bg', 4.5],
];

describe('colour maths', () => {
  it('round-trips hex through OKLCH', () => {
    for (const hex of ['#EFC75E', '#1F3A5F', '#FFFFFF', '#000000', '#DC2626']) {
      expect(oklchToHex(hexToOklch(hex)).toUpperCase()).toBe(hex);
    }
  });
});

describe('generateTheme', () => {
  it('uses the honey seed as the accent by default', () => {
    const t = generateTheme({ ...DEFAULT_THEME, mode: 'light' });
    expect(t.accent).toBe('#EFC75E');
    expect(t.primary).toBe('#EFC75E');
    expect(t.radius).toBe('14px');
    expect(contrast(t['accent-foreground']!, '#000000')).toBeLessThan(3); // dark text on honey
  });

  it('keeps every text pair readable for every swatch, mode and option', () => {
    for (const seed of SEED_POOL) {
      for (const mode of ['light', 'dark'] as const) {
        for (const sidebar of ['dark', 'light'] as const) {
          for (const warmth of [0, 45, 100]) {
            const opts: ThemeOptions = { seed, warmth, radius: 14, sidebar, buttons: 'accent', mode };
            const t = generateTheme(opts);
            for (const [fg, bg, min] of pairs) {
              const ratio = contrast(t[fg]!, t[bg]!);
              expect(ratio, `${seed} ${mode} ${sidebar} w${warmth}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(
                min,
              );
            }
          }
        }
      }
    }
  });

  it('never themes status colours', () => {
    const a = generateTheme({ ...DEFAULT_THEME, mode: 'light' });
    const b = generateTheme({ ...DEFAULT_THEME, seed: '#4F46E5', mode: 'light' });
    expect(a['status-bad-bg']).toBe(b['status-bad-bg']);
  });

  it('falls back to the default seed for invalid input and clamps radius', () => {
    const t = generateTheme({ ...DEFAULT_THEME, seed: 'nope', radius: 99, mode: 'light' });
    expect(t.accent).toBe('#EFC75E');
    expect(t.radius).toBe('22px');
  });

  it('warns when a seed looks like a status colour', () => {
    expect(seedClashesWithStatus('#DC2626')).toBe('bad');
    expect(seedClashesWithStatus('#4F46E5')).toBeNull();
    expect(seedClashesWithStatus('#5B5F66')).toBeNull();
  });
});
