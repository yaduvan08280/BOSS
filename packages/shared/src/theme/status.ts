/**
 * Fixed status colours. Never themed: "Overdue" must look the same in every company and every module.
 * Each tone has an icon (lucide name) so colour is never the only signal.
 */
export const STATUS_TONES = ['ok', 'warn', 'bad', 'over', 'info', 'neutral'] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

type Pair = { bg: string; fg: string; solid: string };

export const STATUS_COLORS: Record<'light' | 'dark', Record<StatusTone, Pair>> = {
  light: {
    ok: { bg: '#E3F0DA', fg: '#2C5E14', solid: '#3B7D1E' },
    warn: { bg: '#FCE8D2', fg: '#8A3F05', solid: '#C25E0A' },
    bad: { bg: '#FBE2DE', fg: '#9E1F14', solid: '#C2361F' },
    over: { bg: '#ECE8FB', fg: '#47309A', solid: '#6247C4' },
    info: { bg: '#E2EEFA', fg: '#124A80', solid: '#2269B0' },
    neutral: { bg: '#EEECE6', fg: '#46443F', solid: '#6B6862' },
  },
  dark: {
    ok: { bg: '#22351A', fg: '#B5DD97', solid: '#7FBF55' },
    warn: { bg: '#3E2A12', fg: '#F5BF85', solid: '#F0954A' },
    bad: { bg: '#43201B', fg: '#F4A79C', solid: '#F07B66' },
    over: { bg: '#2E2650', fg: '#C9BCF7', solid: '#A08DF0' },
    info: { bg: '#16304A', fg: '#A9CDF2', solid: '#6AA8E8' },
    neutral: { bg: '#2E2D2A', fg: '#D3D0C8', solid: '#A6A298' },
  },
};

export const STATUS_ICONS: Record<StatusTone, string> = {
  ok: 'check',
  warn: 'clock',
  bad: 'triangle-alert',
  over: 'arrow-up',
  info: 'play',
  neutral: 'hourglass',
};

/** Hue ranges (OKLCH degrees) that a brand colour should avoid; used for the Appearance warning. */
export const STATUS_HUE_RANGES: Record<'bad' | 'warn' | 'ok', [number, number]> = {
  bad: [15, 45],
  warn: [55, 100],
  ok: [125, 160],
};
