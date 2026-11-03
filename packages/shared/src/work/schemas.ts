import { z } from 'zod';
import { frequencySchema } from './recurrence';

const id = z.string().min(1);
const when = z.iso.datetime({ offset: true });

export const taskCreateSchema = z.object({
  doerId: id,
  plannedAt: when,
  verifierId: id.nullish(),
  description: z.string().trim().min(3, 'Describe the task').max(2000),
  requireProof: z.boolean().default(false),
  attachmentIds: z.array(id).max(20).default([]),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskImportSchema = z.object({
  tasks: z
    .array(taskCreateSchema.omit({ attachmentIds: true }))
    .min(1)
    .max(500),
});

export const taskActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('decline'), reason: z.string().trim().min(3, 'Say why').max(500) }),
  z.object({
    action: z.literal('moveDate'),
    plannedAt: when,
    reason: z.string().trim().min(3, 'Say why the date is changing').max(500),
  }),
  z.object({ action: z.literal('addFollowUp'), note: z.string().trim().min(1).max(1000) }),
  z.object({
    action: z.literal('markDone'),
    note: z.string().trim().min(3, 'Write what was done').max(2000),
    attachmentIds: z.array(id).max(20).default([]),
  }),
  z.object({ action: z.literal('verify'), comment: z.string().trim().max(500).optional() }),
  z.object({
    action: z.literal('reject'),
    comment: z.string().trim().min(3, 'Say what is missing').max(500),
  }),
  z.object({ action: z.literal('reopen'), comment: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('reassign'), doerId: id, plannedAt: when.optional() }),
  z.object({
    action: z.literal('passOn'),
    doerId: id,
    note: z.string().trim().min(3, 'Write what you did').max(2000),
    plannedAt: when,
    attachmentIds: z.array(id).max(20).default([]),
  }),
  z.object({ action: z.literal('addNote'), note: z.string().trim().min(1, 'Write the note').max(2000) }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().max(500).optional() }),
]);
export type TaskActionInput = z.infer<typeof taskActionSchema>;

export const taskEditSchema = z.object({
  description: z.string().trim().min(3).max(2000).optional(),
  verifierId: id.nullable().optional(),
  requireProof: z.boolean().optional(),
});

export const checklistItemSchema = z.object({
  key: z.string().min(1).max(40),
  text: z.string().trim().min(1, 'Write the item').max(300),
  requirePhoto: z.boolean().default(false),
  requireVoice: z.boolean().default(false),
  requireValue: z.boolean().default(false),
});

export const checklistMasterSchema = z.object({
  name: z.string().trim().min(2, 'Name the checklist').max(120),
  departmentId: id.nullish(),
  branchId: id.nullish(),
  items: z.array(checklistItemSchema).min(1, 'Add at least one item').max(60),
  frequency: frequencySchema,
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  windowHours: z.number().int().min(1).max(72),
  doerIds: z.array(id).min(1, 'Pick who does it').max(50),
  verifierId: id.nullish(),
  skipHolidays: z.boolean().default(true),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active: z.boolean().default(true),
  reminderPatternId: id.nullish(),
});
export type ChecklistMasterInput = z.infer<typeof checklistMasterSchema>;

export const runItemUpdateSchema = z.object({
  itemId: id,
  done: z.boolean(),
  value: z.string().max(200).nullish(),
  note: z.string().max(500).nullish(),
  attachmentId: id.nullish(),
});

export const runActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit'), note: z.string().max(1000).optional() }),
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('reject'), comment: z.string().trim().min(3).max(500) }),
]);
