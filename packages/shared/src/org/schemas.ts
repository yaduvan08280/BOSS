import { z } from 'zod';
import { LANGUAGES, THEME_MODES, USER_STATUS } from '../enums';
import { themeSettingsSchema } from '../auth/schemas';

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 09:30');
const id = z.string().min(1);

export const companyProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter the trading name').max(120),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  state: z.string().trim().min(2, 'Choose the state').max(80),
  ownerName: z.string().trim().min(2, 'Enter the owner or contact name').max(120),
  mobile: z.string().trim().min(8, 'Enter a mobile number').max(20),
  email: z.union([z.email('Enter a valid email'), z.literal('')]).nullish(),
  website: optionalText(200),
  cin: optionalText(30),
  gstin: optionalText(15),
  legalName: optionalText(160),
  pan: optionalText(10),
});
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;

export const contactSchema = z.object({
  role: z.string().trim().min(1, 'Enter a role').max(60),
  name: z.string().trim().min(1, 'Enter a name').max(120),
  phone: optionalText(20),
  email: optionalText(160),
});
export type ContactInput = z.infer<typeof contactSchema>;

export const shiftSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
  start: hhmm,
  end: hhmm,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one working day'),
  isDefault: z.boolean().optional(),
});
export type ShiftInput = z.infer<typeof shiftSchema>;

export const branchSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  code: optionalText(20),
  parentId: id.nullish(),
  city: optionalText(80),
  state: optionalText(80),
  isDefault: z.boolean().optional(),
});
export type BranchInput = z.infer<typeof branchSchema>;

export const designationSchema = z.object({ name: z.string().trim().min(1).max(80), color: optionalText(9) });

export const departmentCreateSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80),
  parentId: id.nullish(),
});
export const departmentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  parentId: id.nullable().optional(),
  hodUserId: id.nullable().optional(),
  color: optionalText(9).optional(),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(120),
  mobile: optionalText(20),
  email: optionalText(160),
  roleId: id.optional(),
  mainDepartmentId: id.nullish(),
  designationId: id.nullish(),
  reportsToId: id.nullish(),
  branchId: id.nullish(),
  shiftId: id.nullish(),
  loginEnabled: z.boolean().optional(),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const hrDetailsSchema = z.object({
  doj: optionalText(10),
  dob: optionalText(10),
  biometricId: optionalText(40),
  bankName: optionalText(80),
  bankAccount: optionalText(40),
  ifsc: optionalText(15),
  pan: optionalText(10),
  aadhaarLast4: z
    .string()
    .regex(/^\d{4}$/, 'Last 4 digits only')
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
  salary: z.number().int().min(0).nullish(),
});
export type HrDetails = z.infer<typeof hrDetailsSchema>;

export const userUpdateSchema = userCreateSchema.partial().extend({
  status: z.enum(USER_STATUS).optional(),
  alsoWorksIn: z.array(id).optional(),
  hr: hrDetailsSchema.partial().optional(),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const pastedPersonSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  department: z.string().trim().max(80).nullable(),
  designation: z.string().trim().max(80).nullable(),
});
export const bulkCreateSchema = z.object({
  people: z.array(pastedPersonSchema).min(1).max(500),
  /** Create departments/designations that don't exist yet. */
  createMissing: z.boolean().default(true),
});

export const bulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('moveDepartment'), userIds: z.array(id).min(1), departmentId: id.nullable() }),
  z.object({ action: z.literal('setRole'), userIds: z.array(id).min(1), roleId: id }),
  z.object({ action: z.literal('enableLogin'), userIds: z.array(id).min(1), enabled: z.boolean() }),
]);
export type BulkAction = z.infer<typeof bulkActionSchema>;

export const roleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: z.array(z.string().max(60)).max(200),
});

export const moveInDepartmentSchema = z.object({
  userId: id,
  toDepartmentId: id,
  mode: z.enum(['also', 'move', 'hod']),
  fromDepartmentId: id.nullish(),
});

export const appearanceSchema = z.object({
  appName: z.string().trim().min(1).max(40),
  theme: themeSettingsSchema,
  defaultLang: z.enum(LANGUAGES),
  defaultThemeMode: z.enum(THEME_MODES),
  staffMayPickAccent: z.boolean(),
  logoFileId: z.string().nullable(),
});
export type AppearanceInput = z.infer<typeof appearanceSchema>;

export const favouritesSchema = z.object({ favourites: z.array(z.string().max(40)).max(50) });
