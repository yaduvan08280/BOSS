import { z } from 'zod';
import { FIELD_TYPES, STEP_TYPES } from '../fms/definition';

/**
 * What the AI must return. Kept plain (every key present, null instead of missing, no patterns or limits)
 * so every provider's structured output can follow it; MONO checks and converts it afterwards.
 */
export const aiFieldSchema = z.object({
  label: z.string().describe('What the person fills in, e.g. "Customer name"'),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string()).describe('Choices for dropdown / multiselect; empty otherwise'),
});
export type AiField = z.infer<typeof aiFieldSchema>;

export const aiStepSchema = z.object({
  key: z
    .string()
    .describe('Short id in lowercase with underscores, e.g. "confirm_order". Keep existing ids.'),
  name: z.string().describe('What happens, in a few words, e.g. "Confirm the order"'),
  type: z.enum(STEP_TYPES),
  doers: z.array(z.string()).describe('Names of the people who do it, exactly as the user wrote them'),
  byStarter: z.boolean().describe('True when whoever started the record does this step'),
  time: z
    .object({
      value: z.number(),
      unit: z.enum(['minutes', 'hours', 'days']),
      from: z.enum(['previous', 'start']).describe('Counted from the previous step or from the start'),
    })
    .nullable()
    .describe('How long the step may take; null if the user gave no hint'),
  fields: z.array(aiFieldSchema).describe('What the doer fills in at this step'),
  checklist: z.array(z.string()),
  proofRequired: z.boolean().describe('A photo or file is needed to finish the step'),
  yes: z.string().nullable().describe('DECISION: key of the step after Yes, or "end"'),
  no: z.string().nullable().describe('DECISION: key of the step after No, or "end"'),
  next: z.string().nullable().describe('Only when it does not go to the following step: a key or "end"'),
  rejectTo: z.string().nullable().describe('APPROVAL: key of the step a rejection goes back to'),
  autoAction: z.enum(['message', 'document', 'webhook']).nullable().describe('AUTO steps only'),
  documentType: z.string().nullable().describe('AUTO document: one of the document type codes given'),
  autoText: z.string().nullable().describe('AUTO message: the text sent'),
  notifyCustomer: z.boolean().describe('Send the customer a WhatsApp update when done'),
});
export type AiStep = z.infer<typeof aiStepSchema>;

export const aiFlowDraftSchema = z.object({
  name: z.string(),
  runName: z.string().describe('What one run is called: Order, Lead, Complaint…'),
  departments: z.array(z.string()),
  coordinator: z.string().nullable().describe('Who follows up that steps finish on time'),
  solver: z.string().nullable().describe('Who steps in when a step is stuck'),
  startFields: z.array(aiFieldSchema),
  steps: z.array(aiStepSchema),
  remember: z
    .array(z.string())
    .describe('Short facts about this business worth remembering for next time (may be empty)'),
});
export type AiFlowDraft = z.infer<typeof aiFlowDraftSchema>;

export const aiKpiSchema = z.object({
  cards: z.array(
    z.object({
      label: z.string(),
      source: z.string().describe('"count", "start:<field key>" or "step:<step key>:<field key>"'),
      aggregation: z.enum(['COUNT', 'TOTAL', 'AVERAGE', 'MIN', 'MAX']),
      period: z.enum(['TODAY', 'WEEK', 'MONTH', 'FY']),
      why: z.string(),
    }),
  ),
});
export type AiKpi = z.infer<typeof aiKpiSchema>;

export const aiMasterSchema = z.object({
  name: z.string(),
  description: z.string(),
  fields: z.array(aiFieldSchema),
  keyField: z.string().nullable().describe('Label of the field that is unique for each row'),
  displayField: z.string().nullable().describe('Label of the field shown when it is picked elsewhere'),
});
export type AiMaster = z.infer<typeof aiMasterSchema>;

export const aiBusinessSchema = z.object({ text: z.string() });

export const aiTextSchema = z.object({ text: z.string() });

/** "Build a record type with AI" (plan §2.6): what the model proposes, in labels — MONO makes the keys. */
export const aiRecordTypeSchema = z.object({
  name: z.string().describe('One record, singular: "Site visit", "Prescription", "Trip"'),
  pluralName: z.string().describe('Many of them: "Site visits"'),
  prefix: z.string().describe('2 to 5 capital letters for its numbers, e.g. "SV" → SV/26-27/0001'),
  description: z.string().describe('One line: what this record is'),
  fields: z.array(aiFieldSchema),
  titleField: z.string().nullable().describe('Label of the field that names a record (shown as its title)'),
  tables: z
    .array(z.object({ label: z.string(), fields: z.array(aiFieldSchema) }))
    .describe(
      'Child lines: tables inside the record (items, visits, instalments); empty when there are none',
    ),
  statuses: z
    .array(
      z.object({
        label: z.string(),
        kind: z
          .enum(['ok', 'warn', 'bad', 'over', 'info', 'neutral'])
          .describe(
            'info = running, warn = waiting, ok = done well, bad = failed, neutral = not started / closed',
          ),
        final: z.boolean().describe('True when a record in this status is closed (nothing moves it on)'),
      }),
    )
    .describe('Where a record can stand, in the order it usually goes'),
  start: z.string().describe('Label of the status a new record starts in'),
  moves: z
    .array(
      z.object({
        from: z.string().describe('Label of the status the button shows in'),
        to: z.string().describe('Label of the status it leads to'),
        label: z.string().describe('The button text: "Confirm", "Send back", "Cancel"'),
        who: z
          .enum(['edit', 'approve', 'creator'])
          .describe(
            'edit = anyone who may change these records, approve = approvers, creator = whoever made it',
          ),
        noteRequired: z.boolean().describe('The person must write why (rejections, cancellations)'),
      }),
    )
    .describe('The allowed changes of status'),
});
export type AiRecordType = z.infer<typeof aiRecordTypeSchema>;
