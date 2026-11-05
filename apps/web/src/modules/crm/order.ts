import { toPaise } from './api';

export type OrderDraft = {
  amount: string;
  gp: string;
  promisedOn: string;
  note: string;
  items: { item: string; qty: string; rate: string }[];
};
export const emptyOrder = (promisedOn: string): OrderDraft => ({
  amount: '',
  gp: '',
  promisedOn,
  note: '',
  items: [],
});

/** The order as the API wants it (paise), or null while something is missing or wrong. */
export function orderBody(o: OrderDraft) {
  const items = o.items.filter((i) => i.item.trim() || i.qty || i.rate);
  const lines = items.map((i) => ({ item: i.item.trim(), qty: Number(i.qty), rate: toPaise(i.rate) ?? -1 }));
  if (lines.some((l) => !l.item || !(l.qty > 0) || l.rate < 0)) return null;
  const fromLines = lines.reduce((a, l) => a + Math.round(l.qty * l.rate), 0);
  const amount = toPaise(o.amount) ?? (fromLines || null);
  if (!amount || amount <= 0) return null;
  const gp = o.gp.trim() ? toPaise(o.gp) : undefined;
  if (gp === null || (gp !== undefined && gp > amount)) return null;
  return {
    amount,
    gp,
    items: lines,
    promisedOn: o.promisedOn || undefined,
    note: o.note.trim() || undefined,
  };
}
