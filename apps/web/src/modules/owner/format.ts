import { formatINR } from '@mono/shared';

export const rupees = (paise: number) => formatINR(Math.round(paise), { compact: true });
export const dmy = (day: string) => day.split('-').reverse().join('/');
export const percent = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
