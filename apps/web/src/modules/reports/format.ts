/** Numbers as people here write them: 12,34,567.5 (two decimals at most). */
export const showNumber = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
