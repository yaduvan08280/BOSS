import { z } from 'zod';
import { LANGUAGES, THEME_MODES } from '../enums';

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your mobile number or email').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
  companyId: z.string().min(1).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordRule = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Use at least one letter')
  .regex(/\d/, 'Use at least one number');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordRule,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'The new password must be different',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const companyChoiceSchema = z.object({ id: z.string(), name: z.string() });

export const themeSettingsSchema = z.object({
  seed: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  warmth: z.number().int().min(0).max(100),
  radius: z.number().int().min(4).max(22),
  sidebar: z.enum(['dark', 'light']),
  buttons: z.enum(['accent', 'ink']),
});
export type ThemeSettings = z.infer<typeof themeSettingsSchema>;

export const meSchema = z.object({
  user: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    mobile: z.string().nullable(),
    lang: z.enum(LANGUAGES),
    themeMode: z.enum(THEME_MODES),
    avatarUrl: z.string().nullable(),
    roleName: z.string(),
    roleKey: z.string().nullable(),
    permissions: z.array(z.string()),
    mustChangePassword: z.boolean(),
    favourites: z.array(z.string()),
  }),
  company: z.object({
    id: z.string(),
    name: z.string(),
    appName: z.string(),
    timezone: z.string(),
    fyStartMonth: z.number().int(),
    theme: themeSettingsSchema,
    logoUrl: z.string().nullable(),
    defaultLang: z.enum(LANGUAGES),
    staffMayPickAccent: z.boolean(),
    hospitality: z.boolean().default(false),
    /** Phase 20: the words of the company's packs — an i18n key → what to show instead. */
    words: z.record(z.string(), z.object({ en: z.string(), hi: z.string().optional() })).default({}),
  }),
  counters: z.object({ pendingWork: z.number().int(), unreadNotifications: z.number().int() }),
});
export type Me = z.infer<typeof meSchema>;
