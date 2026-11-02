import { z } from 'zod';
import { CHANNELS, OVERDUE_REPEAT, REMIND_AT, TEMPLATE_CHANNELS } from './catalog';

const recipient = z.string().regex(/^([a-z]+|user:[\w-]+)$/, 'Unknown recipient');

export const templateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{3,60}$/, 'Use lowercase letters, numbers and _'),
  channel: z.enum(TEMPLATE_CHANNELS),
  event: z.string().max(60).nullable(),
  category: z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']).default('UTILITY'),
  language: z.enum(['en', 'hi']).default('en'),
  subject: z.string().max(200).nullable().optional(),
  body: z.string().trim().min(1).max(4000),
  active: z.boolean().optional(),
});

export const ruleSchema = z.object({
  event: z.string().min(3).max(60),
  audience: z.enum(['team', 'client', 'vendor']),
  recipients: z.array(recipient).min(1, 'Pick who gets it').max(10),
  channels: z.array(z.enum(CHANNELS)).min(1, 'Pick at least one channel'),
  waitMinutes: z.number().int().min(0).max(10080).default(0),
  escalateTo: recipient.nullable().optional(),
  escalateAfterMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  aiFollowUp: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type RuleInput = z.infer<typeof ruleSchema>;

export const reminderPatternSchema = z.object({
  name: z.string().trim().min(1).max(60),
  remindAt: z.array(z.enum(REMIND_AT)).min(1),
  channels: z.array(z.enum(CHANNELS)).min(1),
  overdueRepeat: z.enum(OVERDUE_REPEAT),
  isDefault: z.boolean().optional(),
});

export const WHATSAPP_PROVIDERS = ['wati', 'aisensy', 'interakt', 'kit19'] as const;

export const channelConfigSchemas = {
  email: z.object({
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().trim().optional(),
    pass: z.string().optional(),
    from: z.string().trim().min(3),
  }),
  telegram: z.object({
    token: z
      .string()
      .trim()
      .regex(/^\d+:[\w-]{30,}$/, 'Paste the token from @BotFather')
      .optional(),
    groupChatId: z.string().trim().max(30).nullable().optional(),
  }),
  whatsapp: z.object({
    provider: z.enum(WHATSAPP_PROVIDERS),
    endpoint: z.string().trim().url().optional(),
    apiKey: z.string().trim().min(8).optional(),
    displayName: z.string().trim().max(60).optional(),
    number: z.string().trim().max(20).optional(),
  }),
  push: z.object({ subject: z.string().trim().min(5).optional() }),
} as const;
export type ChannelKey = keyof typeof channelConfigSchemas;
