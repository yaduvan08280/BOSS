import { z } from 'zod';

const id = z.string().min(1);
const when = z.iso.datetime({ offset: true });
const files = z.array(id).max(10).default([]);
const words = (min: number, max: number) => z.string().trim().min(min).max(max);

// ---- Help Slip (§5.3) ----
export const slipCreateSchema = z.object({
  problem: words(10, 2000),
  solutions: z.array(words(3, 1000)).min(1).max(3),
  departmentId: id.nullish(),
  attachmentIds: files,
});
export type SlipCreateInput = z.infer<typeof slipCreateSchema>;

export const slipActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('forward'), note: z.string().max(1000).optional() }),
  z.object({ action: z.literal('return'), comment: words(3, 1000) }),
  z.object({
    action: z.literal('resubmit'),
    problem: words(10, 2000).optional(),
    solutions: z.array(words(3, 1000)).min(1).max(3).optional(),
  }),
  z.object({
    action: z.literal('approve'),
    /** Pick one of the raiser's solutions, or write your own. */
    solutionId: id.optional(),
    ownSolution: words(3, 1000).optional(),
    doerId: id,
    plannedAt: when,
    note: z.string().max(1000).optional(),
  }),
  z.object({ action: z.literal('reject'), reason: words(3, 1000) }),
  z.object({ action: z.literal('close'), note: z.string().max(1000).optional() }),
  z.object({ action: z.literal('withdraw'), reason: z.string().max(1000).optional() }),
]);
export type SlipActionInput = z.infer<typeof slipActionSchema>;

// ---- Help Ticket (§5.4) ----
export const ticketCreateSchema = z.object({
  title: words(3, 200),
  description: z.string().trim().max(4000).default(''),
  solverId: id,
  /** Leave empty for "now + the company's fix time". */
  plannedFixAt: when.optional(),
  departmentId: id.nullish(),
  attachmentIds: files,
});
export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;

export const ticketActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), text: words(1, 4000), attachmentIds: files }),
  z.object({ action: z.literal('resolve'), note: words(3, 4000), attachmentIds: files }),
  z.object({ action: z.literal('confirm') }),
  z.object({ action: z.literal('reopen'), comment: words(3, 2000) }),
  z.object({ action: z.literal('comment'), text: words(1, 4000), attachmentIds: files }),
  z.object({ action: z.literal('movePlan'), plannedFixAt: when, reason: words(3, 1000) }),
  z.object({ action: z.literal('reassign'), solverId: id, plannedFixAt: when.optional() }),
  z.object({ action: z.literal('cancel'), reason: z.string().max(1000).optional() }),
]);
export type TicketActionInput = z.infer<typeof ticketActionSchema>;

// ---- EA board (§5.5) ----
export const EA_KINDS = ['task', 'meeting', 'call', 'review'] as const;
export type EaKind = (typeof EA_KINDS)[number];

export const eaCaptureSchema = z.object({ text: words(1, 500), ownerId: id.optional() });

export const eaActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('toInformation') }),
  z.object({ action: z.literal('toSomeday') }),
  z.object({ action: z.literal('toWaiting'), waitingOn: z.string().trim().max(200).optional() }),
  z.object({
    action: z.literal('schedule'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    minutes: z.number().int().min(15).max(600),
    kind: z.enum(EA_KINDS),
  }),
  z.object({
    action: z.literal('delegate'),
    doerId: id,
    plannedAt: when,
    description: words(3, 2000).optional(),
  }),
  z.object({ action: z.literal('done') }),
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('reopen') }),
]);
export type EaActionInput = z.infer<typeof eaActionSchema>;

export const eaEditSchema = z.object({
  text: words(1, 500).optional(),
  note: z.string().max(2000).nullish(),
});
