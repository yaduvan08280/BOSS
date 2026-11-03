import { z } from 'zod';

/** CLAUDE.md §6.1 — what a flow is made of. A published version is frozen; records keep the version they started on. */
export const FIELD_TYPES = [
  'text',
  'longtext',
  'number',
  'amount',
  'date',
  'datetime',
  'yesno',
  'dropdown',
  'multiselect',
  'photo',
  'file',
  'signature',
  'mobile',
  'email',
  'items',
  'master',
  'location',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, digits and _');

export const fieldSchema = z.object({
  key,
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  help: z.string().max(200).optional(),
  /** dropdown / multiselect choices */
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  /** "from a master": which master (customers, items, vendors, people…) */
  master: z.string().max(40).optional(),
});
export type FlowField = z.infer<typeof fieldSchema>;

export const STEP_TYPES = ['TASK', 'DECISION', 'APPROVAL', 'OUTSIDE', 'AUTO'] as const;
export type StepType = (typeof STEP_TYPES)[number];

/** When a step is due: N hours/days after the previous step, after the record started, around a date field, or at a fixed time. */
export const stepTimeSchema = z.object({
  value: z.number().min(0).max(10_000),
  unit: z.enum(['minutes', 'hours', 'days']),
  anchor: z.enum(['previous', 'start', 'dateField', 'fixed']),
  /** dateField: which start/step field holds the date */
  field: z.string().max(40).optional(),
  /** dateField: before (true) or after (false) that date */
  before: z.boolean().optional(),
  /** fixed: the clock time (HH:mm) on the day the step opens, or the next working day if already past */
  at: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});
export type StepTime = z.infer<typeof stepTimeSchema>;

export const AUTO_ACTIONS = ['message', 'document', 'webhook', 'stock'] as const;

export const stepSchema = z.object({
  key,
  name: z.string().trim().min(1).max(100),
  type: z.enum(STEP_TYPES),
  /** Who does it. `starter` = whoever started the record (e.g. the salesperson who took the order). */
  doerIds: z.array(z.string()).max(20).default([]),
  starter: z.boolean().default(false),
  backupIds: z.array(z.string()).max(10).default([]),
  /** Missing until the builder sets it: publishing refuses steps without a time. */
  time: stepTimeSchema.optional(),
  checklist: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  fields: z.array(fieldSchema).max(40).default([]),
  /** Document type codes to create when the step is done (or by an AUTO step). */
  documents: z.array(z.string().max(20)).max(5).default([]),
  proofRequired: z.boolean().default(false),
  /** Where to go next; default = the next step in the list. "end" closes the record. */
  next: z.string().max(40).optional(),
  /** DECISION: where Yes and No lead. */
  yes: z.string().max(40).optional(),
  no: z.string().max(40).optional(),
  /** APPROVAL: where a rejection sends it back (default: the step before). */
  rejectTo: z.string().max(40).optional(),
  auto: z
    .object({
      action: z.enum(AUTO_ACTIONS),
      text: z.string().max(1000).optional(),
      documentType: z.string().max(20).optional(),
      url: z.url().optional(),
    })
    .optional(),
  /** Send the customer a WhatsApp update when this step is done. */
  notifyCustomer: z.boolean().default(false),
});
export type FlowStep = z.infer<typeof stepSchema>;

export const flowDefinitionSchema = z.object({
  startFields: z.array(fieldSchema).max(40).default([]),
  steps: z.array(stepSchema).max(60).default([]),
  /** "Working shifts" counts only shift hours (skipping holidays and weekly offs); "full calendar" counts every hour. */
  timeModel: z.enum(['shifts', 'calendar']).default('shifts'),
});
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;

export const END = 'end';

export const flowMetaSchema = z.object({
  name: z.string().trim().min(2).max(100),
  runName: z.string().trim().min(2).max(40).default('Record'),
  departmentIds: z.array(z.string()).max(20).default([]),
  coordinatorId: z.string().nullish(),
  coordinatorBackupId: z.string().nullish(),
  solverId: z.string().nullish(),
  solverBackupId: z.string().nullish(),
  videoUrl: z.url().nullish().or(z.literal('')),
  description: z.string().max(4000).nullish(),
});
export type FlowMeta = z.infer<typeof flowMetaSchema>;
