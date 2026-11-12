import type { world } from '../records/testkit';

export type World = Awaited<ReturnType<typeof world>>;
export type Api = World['api'];
export const ok = async <T>(p: Promise<{ status: number; body: T }>): Promise<T> => {
  const r = await p;
  if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
export type BillOut = {
  id: string;
  number: string | null;
  status: string;
  total: number;
  tax: number;
  taxable: number;
  due: number;
  settled: number;
  credited: number;
  roundOff: number;
  currency: string;
  taxes: { name: string; percent: number; amount: number }[];
};

/** A company in Rajasthan with a GSTIN, the usual rates, a customer in the state and one outside, a vendor. */
export async function books(w: World) {
  await ok(
    w.api.put('/api/org/company', {
      name: 'Levanto Foods',
      city: 'Jaipur',
      state: 'Rajasthan',
      ownerName: 'Owner',
      mobile: '9829000001',
      gstin: '08AAACL1234E1Z1',
    }),
  );
  const rate = (code: string, percent: number, from = '2020-01-01', more: object = {}) =>
    ok(w.api.put('/api/money/tax-rates', { code, name: `${code}`, percent, from, ...more }));
  await rate('GST5', 5);
  await rate('GST18', 18);
  const party = (name: string, kinds: string[], more: object = {}) =>
    ok<{ id: string; code: string }>(w.api.post('/api/money/parties', { name, kinds, ...more }));
  const sharma = await party('Sharma Traders', ['customer'], { state: 'Rajasthan', creditDays: 15 });
  const delhi = await party('Delhi Caterers', ['customer'], { state: 'Delhi' });
  const dairy = await party('Jaipur Dairy', ['vendor'], { state: 'Rajasthan' });
  const cash = await ok<{ id: string }>(w.api.post('/api/money/modes', { name: 'Cash', kind: 'CASH' }));
  const upi = await ok<{ id: string }>(w.api.post('/api/money/modes', { name: 'UPI', kind: 'UPI' }));
  const bill = (api: Api, body: object) => ok<BillOut>(api.post('/api/money/bills', body));
  return { rate, party, sharma, delhi, dairy, cash, upi, bill };
}
export const meal = [
  { item: 'Paneer tikka', hsn: '996331', qty: 2, rate: 320_00, taxCode: 'GST5' },
  { item: 'Soft drink', qty: 3, rate: 60_00, taxCode: 'GST18' },
];
