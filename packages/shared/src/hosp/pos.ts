import { z } from 'zod';

/**
 * Phase 15 — the POS (shared schemas and pure rules): orders, kitchen tickets, checks, splitting a bill, the
 * table's colour on the floor, ticket timers, the day's reports.
 */
export const ORDER_TYPES = [
  'DINE_IN',
  'TAKEAWAY',
  'DELIVERY',
  'ROOM_SERVICE',
  'STAFF_MEAL',
  'COUNTER',
] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const COURSES = ['STARTER', 'MAIN', 'DESSERT', 'DRINK'] as const;
export type Course = (typeof COURSES)[number];

const id = z.string().min(1).max(40);
export const orderSchema = z.object({
  outletId: id,
  type: z.enum(ORDER_TYPES).default('DINE_IN'),
  tableIds: z.array(id).max(12).default([]),
  covers: z.number().int().min(1).max(200).default(1),
  stewardId: id.nullish(),
  guestName: z.string().trim().max(80).nullish(),
  /** A party to bill (a company with a GSTIN); left out, a walk-in guest. */
  partyId: id.nullish(),
  roomNo: z.string().trim().max(12).nullish(),
  note: z.string().trim().max(300).nullish(),
  /** A key made on the device: the same order sent twice (a queue that retried) is made once. */
  clientId: z.string().trim().min(8).max(60).nullish(),
});
export const orderItemSchema = z.object({
  menuItemId: id,
  variantKey: z.string().max(30).default(''),
  qty: z.number().positive().max(999).default(1),
  /** Add-ons picked: group and option keys. */
  modifiers: z
    .array(z.object({ groupId: id, key: z.string().min(1).max(30) }))
    .max(20)
    .default([]),
  note: z.string().trim().max(200).nullish(),
  course: z.enum(COURSES).nullish(),
  seat: z.number().int().min(1).max(60).nullish(),
  /** Keep it back until its course is fired. */
  hold: z.boolean().default(false),
  clientId: z.string().trim().min(8).max(60).nullish(),
});
export const addItemsSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(100),
  fire: z.boolean().default(true),
});
export type OrderItemInput = z.infer<typeof orderItemSchema>;

export type TableState = 'FREE' | 'RESERVED' | 'SEATED' | 'ORDERED' | 'BILLED' | 'PAID';
/**
 * A table's colour on the floor, from its running order: nothing fired = seated; fired = ordered; billed; paid.
 * With no order, a booking due soon makes it reserved.
 */
export function tableState(
  order: { status: string; fired: number } | null | undefined,
  reserved = false,
): TableState {
  if (!order) return reserved ? 'RESERVED' : 'FREE';
  if (order.status === 'PAID') return 'PAID';
  if (order.status === 'BILLED') return 'BILLED';
  return order.fired > 0 ? 'ORDERED' : 'SEATED';
}

/** How long a ticket has waited and its colour: green under the first limit, amber under the second, red after. */
export function ticketAge(firedAt: number, now: number, amberAfterMin = 10, redAfterMin = 20) {
  const minutes = Math.max(0, Math.floor((now - firedAt) / 60_000));
  return {
    minutes,
    tone:
      minutes >= redAfterMin
        ? ('bad' as const)
        : minutes >= amberAfterMin
          ? ('warn' as const)
          : ('ok' as const),
  };
}

/** Split an amount into n equal parts that add up exactly (the extra paise go to the first parts). */
export function splitEqually(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

export const splitSchema = z.discriminatedUnion('by', [
  /** Each listed item goes to a check number. */
  z.object({
    by: z.literal('ITEM'),
    items: z
      .array(z.object({ itemId: id, check: z.number().int().min(1).max(20) }))
      .min(1)
      .max(300),
  }),
  /** One check a seat. */
  z.object({ by: z.literal('SEAT') }),
  /** One bill, paid in equal parts by this many people. */
  z.object({ by: z.literal('EQUAL'), parts: z.number().int().min(2).max(20) }),
  /** One bill, paid in the amounts given (they must add up to it). */
  z.object({ by: z.literal('AMOUNT'), amounts: z.array(z.number().int().min(1)).min(2).max(20) }),
]);
export type SplitInput = z.infer<typeof splitSchema>;

export const checkSchema = z.object({
  /** Which check of the order (1 unless the order was split by item or seat). */
  check: z.number().int().min(1).max(20).default(1),
  /** The guest asked for the service charge to be taken off. */
  noServiceCharge: z.boolean().default(false),
  discount: z
    .object({
      key: z.string().max(30).nullish(),
      kind: z.enum(['PERCENT', 'AMOUNT']),
      value: z.number().min(0).max(1e13),
      reason: z.string().trim().max(200).nullish(),
    })
    .nullish(),
  /** The whole check is no-charge, for this reason. */
  ncReason: z.string().trim().max(60).nullish(),
  partyId: id.nullish(),
  /** A bill number taken from the block reserved for this device (made while the server could not be reached). */
  number: z.string().trim().max(40).nullish(),
});
export const paymentSchema = z.object({
  payments: z
    .array(
      z.object({
        modeId: id,
        amount: z.number().int().min(1).max(1e13),
        reference: z.string().trim().max(80).nullish(),
      }),
    )
    .min(1)
    .max(10),
  /** Tips handed over with the payment, for a steward. */
  tip: z
    .object({ amount: z.number().int().min(1).max(1e12), stewardId: id.nullish(), modeId: id.nullish() })
    .nullish(),
});

/** A UPI pay link for a bill (opens the guest's UPI app; the same text is what a QR on the bill holds). */
export function upiLink(upiId: string, payee: string, amountMinor: number, note: string) {
  const q = Object.entries({ pa: upiId, pn: payee, am: (amountMinor / 100).toFixed(2), cu: 'INR', tn: note })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `upi://pay?${q}`;
}

/** Cash counted by denomination → its total in minor units. */
export const cashTotal = (counts: Record<string, number>) =>
  Object.entries(counts).reduce(
    (n, [note, pieces]) => n + Number(note) * 100 * Math.max(0, Math.floor(pieces)),
    0,
  );
