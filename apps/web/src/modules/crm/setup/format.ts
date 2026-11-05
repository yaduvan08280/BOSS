/** Paise → the rupee text an input starts with. */
export const rupeeText = (paise: number | null | undefined) => (paise ? String(Math.round(paise) / 100) : '');
