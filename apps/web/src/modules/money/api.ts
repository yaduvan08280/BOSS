import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatMoney, minorUnits, type BillType } from '@mono/shared';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/modules/auth/session';

export type Party = {
  id: string;
  code: string;
  name: string;
  kinds: string[];
  mobile: string | null;
  email: string | null;
  taxId: string | null;
  state: string | null;
  address: string | null;
  creditDays: number;
  note: string | null;
};
export type TaxPart = { name: string; percent: number; amount: number };
export type BillLine = {
  item: string;
  hsn?: string | null;
  qty: number;
  unit?: string | null;
  rate: number;
  discount?: number;
  taxCode?: string | null;
  taxable?: number;
  taxPercent?: number;
  total?: number;
};
export type Bill = {
  id: string;
  type: BillType;
  status: 'DRAFT' | 'ISSUED' | 'PART_PAID' | 'PAID' | 'CANCELLED';
  number: string | null;
  date: string;
  partyId: string;
  branchId: string | null;
  currency: string;
  lines: BillLine[];
  charges: { name: string; amount: number; taxCode?: string | null }[];
  discount: number;
  taxInclusive: boolean;
  taxable: number;
  tax: number;
  taxes: TaxPart[];
  roundOff: number;
  total: number;
  settled: number;
  credited: number;
  due: number;
  dueOn: string | null;
  againstId: string | null;
  modeId: string | null;
  reference: string | null;
  note: string | null;
  einvoice?: {
    irn: string;
    ackNo: string | null;
    at: string;
    cancelledAt?: string | null;
    canCancel?: boolean;
  } | null;
};
export type BillDetail = Bill & {
  party: { id: string; name: string; code: string; state: string | null; taxId?: string | null } | null;
  allocations: { billId: string; paymentId: string; amount: number }[];
};
export type Totals = {
  taxable: number;
  tax: number;
  taxes: TaxPart[];
  roundOff: number;
  total: number;
  currency: string;
  regime: string;
};
export type TaxRate = {
  id: string;
  code: string;
  name: string;
  percent: number;
  from: string;
  entityId: string | null;
  slabs: { upTo: number | null; percent: number }[] | null;
};
export type Mode = { id: string; name: string; kind: string; branchId: string | null; active: boolean };
export type OwedRow = {
  party: { id: string; name: string; code: string; mobile: string | null };
  currency: string;
  due: number;
  overdue: number;
  ageing: Record<'0_30' | '31_60' | '61_90' | '90_plus', number>;
  oldestDueOn: string;
  promisedOn: string | null;
  bills: number;
};
export type Statement = {
  party: { id: string; name: string; code: string };
  opening: number;
  closing: number;
  lines: {
    id: string;
    date: string;
    type: BillType;
    number: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
};

const KEY = ['money'] as const;
const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]);
  return p.size ? `?${p}` : '';
};
export const useParties = (kind?: string) =>
  useQuery({
    queryKey: [...KEY, 'parties', kind ?? ''],
    queryFn: () => api<Party[]>(`/api/money/parties${qs({ kind })}`),
  });
export const useBills = (q: { type?: string; partyId?: string }) =>
  useQuery({ queryKey: [...KEY, 'bills', q], queryFn: () => api<Bill[]>(`/api/money/bills${qs(q)}`) });
export const useBill = (id: string | null) =>
  useQuery({
    queryKey: [...KEY, 'bill', id],
    queryFn: () => api<BillDetail>(`/api/money/bills/${id}`),
    enabled: Boolean(id),
  });
export const useTaxRates = () =>
  useQuery({ queryKey: [...KEY, 'rates'], queryFn: () => api<TaxRate[]>('/api/money/tax-rates') });
export const useModes = (branchId?: string) =>
  useQuery({
    queryKey: [...KEY, 'modes', branchId ?? ''],
    queryFn: () => api<Mode[]>(`/api/money/modes${qs({ branchId })}`),
  });
export const useOwed = (side: 'receivable' | 'payable') =>
  useQuery({
    queryKey: [...KEY, 'owed', side],
    queryFn: () => api<{ rows: OwedRow[]; today: string }>(`/api/money/outstanding?side=${side}`),
  });
export const useStatement = (partyId: string | null) =>
  useQuery({
    queryKey: [...KEY, 'statement', partyId],
    queryFn: () => api<Statement>(`/api/money/parties/${partyId}/statement`),
    enabled: Boolean(partyId),
  });

/** Any change to money: call the API, say so, refresh every money list. */
export function useMoneyMutation<I, O = unknown>(
  request: (input: I) => Promise<O>,
  success?: string | ((o: O) => string),
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (o) => {
      const msg = typeof success === 'function' ? success(o) : success;
      if (msg) toast.success(msg);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong'),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Money as people read it: minor units and a currency in, "₹1,23,456.00" or "AED 1,234.00" out. */
export const money = (minor: number, currency = 'INR') => formatMoney(Math.round(minor), currency);
/** What a person types (whole units, with decimals) → minor units, and back for an input. */
export const toMinor = (typed: string, currency = 'INR') =>
  Math.round(Number(typed || 0) * minorUnits(currency));
export const fromMinor = (minor: number | undefined, currency = 'INR') =>
  minor ? String(minor / minorUnits(currency)) : '';

export const BILL_KINDS: BillType[] = [
  'INVOICE',
  'CREDIT_NOTE',
  'PURCHASE_BILL',
  'RECEIPT',
  'VENDOR_PAYMENT',
  'ADVANCE',
  'DEBIT_NOTE',
  'CHALLAN',
];
export const STATUS_TONE: Record<Bill['status'], 'neutral' | 'info' | 'warn' | 'ok' | 'bad'> = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  PART_PAID: 'warn',
  PAID: 'ok',
  CANCELLED: 'bad',
};

/** Today's date (YYYY-MM-DD) on the company's clock — never the browser's or UTC's. */
export const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
export function useToday() {
  return todayIn(useMe().data?.company.timezone ?? 'Asia/Kolkata');
}
