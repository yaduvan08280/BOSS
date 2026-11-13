import { z } from 'zod';

/**
 * Phase 19 — integrations (shared schemas and pure builders): what is sent to a channel manager and what comes
 * back, payment-link requests and webhook events for Razorpay and Cashfree, an aggregator's payout file and its
 * reconciliation, and the e-invoice (IRP) payload of a B2B invoice. Nothing here talks to the network.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');
const id = z.string().min(1).max(60);

export const CONNECTION_KINDS = ['CHANNEL', 'GATEWAY', 'EINVOICE'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export const GATEWAYS = ['RAZORPAY', 'CASHFREE'] as const;
export type Gateway = (typeof GATEWAYS)[number];

export const connectionSchema = z.object({
  kind: z.enum(CONNECTION_KINDS),
  /** The property (channel manager) — left out for the company's gateway and e-invoice connection. */
  branchId: id.nullish(),
  provider: z.string().trim().min(1).max(40),
  /** Where the provider is reached (channel manager and GSP adapters; gateways have their own address). */
  baseUrl: z.string().trim().url().max(300).nullish(),
  /** Keys and secrets: stored encrypted, never sent back. Left out on a later save, the stored ones stay. */
  secret: z.record(z.string(), z.string().max(500)).optional(),
  /** Channel manager: our room type → their room code, our rate plan → their rate code. */
  rooms: z
    .array(z.object({ roomTypeId: id, code: z.string().trim().min(1).max(60) }))
    .max(100)
    .default([]),
  plans: z
    .array(z.object({ ratePlanId: id, code: z.string().trim().min(1).max(60) }))
    .max(100)
    .default([]),
  /** Channel manager: the plan whose rates are pushed and that bookings are made on when none is named. */
  defaultPlanId: id.nullish(),
  /** Payment gateway: the payment mode its money is booked under (left out, one called "Payment gateway" is made). */
  modeId: id.nullish(),
  active: z.boolean().default(true),
});
export type ConnectionInput = z.infer<typeof connectionSchema>;

/** One room type's day as a channel manager wants it. */
export type AriRow = {
  room: string;
  rate: string | null;
  date: string;
  available: number;
  price: number | null;
  stopSell: boolean;
  closedToArrival: boolean;
  minStay: number | null;
};
/** Availability, rates and restrictions for the mapped room types (what is not mapped is not sent). */
export function ariRows(
  inventory: {
    roomTypeId: string;
    day: string;
    left: number;
    rule: { stopSell?: boolean; closedToArrival?: boolean; minStay?: number | null };
  }[],
  price: (roomTypeId: string, day: string) => number | null,
  map: { rooms: { roomTypeId: string; code: string }[]; rateCode: string | null },
): AriRow[] {
  return inventory
    .filter((i) => map.rooms.some((r) => r.roomTypeId === i.roomTypeId))
    .map((i) => ({
      room: map.rooms.find((r) => r.roomTypeId === i.roomTypeId)!.code,
      rate: map.rateCode,
      date: i.day,
      // A channel is never told of rooms that are not there.
      available: Math.max(0, i.left),
      price: price(i.roomTypeId, i.day),
      stopSell: Boolean(i.rule.stopSell),
      closedToArrival: Boolean(i.rule.closedToArrival),
      minStay: i.rule.minStay ?? null,
    }));
}

/** A booking, change or cancellation as a channel manager hands it over. */
export const channelBookingSchema = z.object({
  /** The channel's own booking reference: the same one again is the same booking. */
  ref: z.string().trim().min(1).max(80),
  status: z.enum(['new', 'modified', 'cancelled']).default('new'),
  channel: z.string().trim().max(60).default('OTA'),
  room: z.string().trim().min(1).max(60),
  rate: z.string().trim().max(60).nullish(),
  arrive: day,
  depart: day,
  adults: z.number().int().min(1).max(20).default(2),
  children: z.number().int().min(0).max(20).default(0),
  guest: z.object({
    name: z.string().trim().min(1).max(80),
    phone: z.string().trim().max(30).nullish(),
    email: z.string().trim().max(120).nullish(),
  }),
  /** What the channel sold the stay for, minor units (kept on the booking's note; MONO's own rates price it). */
  total: z.number().int().min(0).nullish(),
  note: z.string().trim().max(500).nullish(),
});
export type ChannelBooking = z.infer<typeof channelBookingSchema>;

export const PAY_PURPOSES = ['RESERVATION_DEPOSIT', 'STAY_ADVANCE', 'BANQUET_ADVANCE', 'POS_CHECK'] as const;
export type PayPurpose = (typeof PAY_PURPOSES)[number];
export const payLinkSchema = z.object({
  purpose: z.enum(PAY_PURPOSES),
  /** The reservation, stay, banquet event or POS check it is for. */
  refId: id,
  /** Minor units; left out, what is due on it. */
  amount: z.number().int().min(100).max(1e12).optional(),
});
export type PayLinkAsk = {
  reference: string;
  amount: number;
  description: string;
  customer: { name: string; phone?: string | null; email?: string | null };
  callbackUrl: string;
};
/** `basic`: a user and password for HTTP basic auth (the caller encodes them). */
type Http = {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  basic?: [string, string];
  body: unknown;
};
/** The request that makes a payment link at a gateway. */
export function payLinkRequest(gateway: Gateway, keys: Record<string, string>, a: PayLinkAsk): Http {
  if (gateway === 'RAZORPAY')
    return {
      url: 'https://api.razorpay.com/v1/payment_links',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      basic: [keys.keyId ?? '', keys.keySecret ?? ''],
      body: {
        amount: a.amount,
        currency: 'INR',
        reference_id: a.reference,
        description: a.description,
        customer: {
          name: a.customer.name,
          contact: a.customer.phone ?? undefined,
          email: a.customer.email ?? undefined,
        },
        notify: { sms: Boolean(a.customer.phone), email: Boolean(a.customer.email) },
        callback_url: a.callbackUrl,
        callback_method: 'get',
      },
    };
  return {
    url: 'https://api.cashfree.com/pg/links',
    method: 'POST',
    headers: {
      'x-client-id': keys.clientId ?? '',
      'x-client-secret': keys.clientSecret ?? '',
      'x-api-version': '2023-08-01',
      'content-type': 'application/json',
    },
    body: {
      link_id: a.reference,
      link_amount: a.amount / 100,
      link_currency: 'INR',
      link_purpose: a.description,
      customer_details: {
        customer_name: a.customer.name,
        customer_phone: a.customer.phone ?? '',
        customer_email: a.customer.email ?? undefined,
      },
      link_meta: { return_url: a.callbackUrl },
    },
  };
}
/** The link a gateway made, from its answer (null when the answer has none). */
export function payLinkMade(gateway: Gateway, json: unknown): { id: string; url: string } | null {
  const j = (json ?? {}) as Record<string, unknown>;
  const linkId = gateway === 'RAZORPAY' ? j.id : (j.cf_link_id ?? j.link_id);
  const url = gateway === 'RAZORPAY' ? j.short_url : j.link_url;
  return linkId && url ? { id: String(linkId), url: String(url) } : null;
}
/**
 * What a gateway's webhook says: which of our references was paid, how much (minor units) and the gateway's
 * payment id. Null for events that are not a payment of a link.
 */
export function payWebhook(
  gateway: Gateway,
  json: unknown,
): { reference: string; amount: number; paymentId: string } | null {
  const j = (json ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (gateway === 'RAZORPAY') {
    if (j.event !== 'payment_link.paid') return null;
    const link = j.payload?.payment_link?.entity;
    const pay = j.payload?.payment?.entity;
    if (!link?.reference_id) return null;
    return {
      reference: String(link.reference_id),
      amount: Number(link.amount_paid ?? pay?.amount ?? 0),
      paymentId: String(pay?.id ?? link.id),
    };
  }
  if (j.type !== 'PAYMENT_LINK_EVENT' || j.data?.link_status !== 'PAID') return null;
  if (!j.data?.link_id) return null;
  return {
    reference: String(j.data.link_id),
    amount: Math.round(Number(j.data.link_amount_paid ?? j.data.link_amount ?? 0) * 100),
    paymentId: String(j.data.order?.transaction_id ?? j.data.cf_link_id ?? j.data.link_id),
  };
}

export const AGGREGATORS = ['ZOMATO', 'SWIGGY', 'OTHER'] as const;
export type PayoutRow = { ref: string; gross: number; deductions: number; net: number };
const ALIASES: Record<keyof PayoutRow, string[]> = {
  ref: ['order id', 'order_id', 'order no', 'order number', 'orderid', 'res order id'],
  gross: [
    'gross',
    'order total',
    'bill amount',
    'subtotal',
    'order value',
    'gross amount',
    'total customer paid',
  ],
  deductions: ['deductions', 'commission', 'total deductions', 'charges', 'fees'],
  net: ['net', 'net payout', 'payout', 'net amount', 'settlement amount', 'net receivable'],
};
/** One line of a CSV file into its cells (quotes may hold commas and doubled quotes). */
export function csvCells(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cell);
      cell = '';
    } else cell += c;
  }
  return [...out, cell].map((x) => x.trim());
}
const money = (text: string | undefined) =>
  Math.round(Number((text ?? '').replace(/[₹,\s]/g, '') || 0) * 100);
/**
 * An aggregator's payout file: the order number, the order's value, what was taken off and what was paid, found
 * by their column headings (several spellings are known). Problems are named by line; lines with no order number
 * are skipped.
 */
export function parsePayout(csv: string): { rows: PayoutRow[]; problems: string[] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], problems: ['The file has no rows'] };
  const head = csvCells(lines[0]!).map((h) => h.toLowerCase());
  const col = (k: keyof PayoutRow) => head.findIndex((h) => ALIASES[k].includes(h));
  const at = { ref: col('ref'), gross: col('gross'), deductions: col('deductions'), net: col('net') };
  const problems: string[] = [];
  if (at.ref < 0) problems.push('No order-number column was found');
  if (at.net < 0) problems.push('No payout column was found');
  if (problems.length) return { rows: [], problems };
  const rows: PayoutRow[] = [];
  lines.slice(1).forEach((line, i) => {
    const c = csvCells(line);
    const ref = c[at.ref];
    if (!ref) return;
    const net = money(c[at.net]);
    const gross = at.gross >= 0 ? money(c[at.gross]) : net;
    const deductions = at.deductions >= 0 ? Math.abs(money(c[at.deductions])) : Math.max(0, gross - net);
    if (rows.some((r) => r.ref === ref)) problems.push(`Line ${i + 2}: order ${ref} is in the file twice`);
    else rows.push({ ref, gross, deductions, net });
  });
  return { rows, problems };
}
export type Reconciled = {
  matched: { ref: string; billed: number; net: number; deductions: number; diff: number }[];
  /** In the file, not on the POS. */
  unknown: PayoutRow[];
  /** On the POS, not in the file. */
  unpaid: { ref: string; billed: number }[];
};
/**
 * Set a payout file against the POS's aggregator orders. `diff` is what does not add up: billed − (paid + what
 * the aggregator took off) — 0 when the file agrees with the bill.
 */
export function reconcile(orders: { ref: string; billed: number }[], rows: PayoutRow[]): Reconciled {
  const byRef = new Map(orders.map((o) => [o.ref, o]));
  const matched: Reconciled['matched'] = [];
  const unknown: PayoutRow[] = [];
  for (const r of rows) {
    const o = byRef.get(r.ref);
    if (!o) unknown.push(r);
    else
      matched.push({
        ref: r.ref,
        billed: o.billed,
        net: r.net,
        deductions: r.deductions,
        diff: o.billed - r.net - r.deductions,
      });
  }
  const seen = new Set(rows.map((r) => r.ref));
  return { matched, unknown, unpaid: orders.filter((o) => !seen.has(o.ref)) };
}

export type EinvoiceInput = {
  seller: { gstin: string; name: string; address: string; place: string; pin: number; stateCode: string };
  buyer: { gstin: string; name: string; address: string; place: string; pin: number; stateCode: string };
  doc: { type: 'INV' | 'CRN' | 'DBN'; number: string; date: string };
  lines: {
    name: string;
    hsn: string | null;
    qty: number;
    unit: string | null;
    rate: number;
    taxable: number;
    percent: number;
    tax: number;
    total: number;
  }[];
  totals: { taxable: number; tax: number; roundOff: number; total: number };
};
const rs = (minor: number) => Math.round(minor) / 100;
const ddmmyyyy = (d: string) => d.split('-').reverse().join('/');
/**
 * The e-invoice (IRP, schema 1.1) of an invoice: seller, buyer, each line with its tax split by the two states
 * (same state CGST + SGST, another state IGST) and the totals. Amounts are rupees with two decimals.
 */
export function einvoicePayload(x: EinvoiceInput) {
  const same = x.seller.stateCode === x.buyer.stateCode;
  const split = (tax: number) =>
    same
      ? { IgstAmt: 0, CgstAmt: rs(tax / 2), SgstAmt: rs(tax - tax / 2) }
      : { IgstAmt: rs(tax), CgstAmt: 0, SgstAmt: 0 };
  const party = (p: EinvoiceInput['seller']) => ({
    Gstin: p.gstin,
    LglNm: p.name,
    Addr1: p.address,
    Loc: p.place,
    Pin: p.pin,
    Stcd: p.stateCode,
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B' },
    DocDtls: { Typ: x.doc.type, No: x.doc.number, Dt: ddmmyyyy(x.doc.date) },
    SellerDtls: party(x.seller),
    BuyerDtls: { ...party(x.buyer), Pos: x.buyer.stateCode },
    ItemList: x.lines.map((l, i) => ({
      SlNo: String(i + 1),
      PrdDesc: l.name,
      IsServc: l.hsn?.startsWith('99') ? 'Y' : 'N',
      HsnCd: l.hsn ?? '',
      Qty: l.qty,
      Unit: (l.unit ?? 'OTH').toUpperCase().slice(0, 8),
      UnitPrice: rs(l.rate),
      TotAmt: rs(l.taxable),
      AssAmt: rs(l.taxable),
      GstRt: l.percent,
      ...split(l.tax),
      TotItemVal: rs(l.total),
    })),
    ValDtls: {
      AssVal: rs(x.totals.taxable),
      ...split(x.totals.tax),
      RndOffAmt: rs(x.totals.roundOff),
      TotInvVal: rs(x.totals.total),
    },
  };
}
/** A GSTIN's first two digits are its state code. */
export const gstinState = (gstin: string | null | undefined) =>
  gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
export const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
