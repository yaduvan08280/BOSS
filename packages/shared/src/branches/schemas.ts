import { z } from 'zod';

/**
 * Phase 12 (plan §3): Group → legal entity → region → branch → location, who runs what, how far a role sees,
 * and the approval chains the owner sets.
 */
const id = z.string().min(1).max(40);
const text = (max: number) => z.string().trim().max(max);
const name = z.string().trim().min(1, 'Enter a name').max(120);

export const ROLE_REACHES = ['own', 'branches', 'entity', 'group'] as const;
export type RoleReach = (typeof ROLE_REACHES)[number];
export const BRANCH_TYPES = ['OUTLET', 'KITCHEN', 'STORE', 'OFFICE', 'HOTEL'] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];
export const ENTITY_KINDS = ['OWN', 'FRANCHISE'] as const;
export const LOCATION_KINDS = ['STORE', 'KITCHEN', 'BAR', 'COLD_ROOM', 'OTHER'] as const;
export const MANAGER_ROLES = ['MANAGER', 'AREA', 'HR'] as const;
export type ManagerRole = (typeof MANAGER_ROLES)[number];

/** An IANA time zone the server knows ("Asia/Kolkata", "Asia/Dubai"). */
export const timezoneSchema = z
  .string()
  .max(60)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

export const entitySchema = z.object({
  name,
  kind: z.enum(ENTITY_KINDS).optional(),
  country: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, 'Two capital letters, like IN or AE')
    .optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'Three capital letters, like INR or AED')
    .optional(),
  state: text(80).nullish(),
  taxId: text(40).nullish(),
  isDefault: z.boolean().optional(),
});
export type EntityInput = z.infer<typeof entitySchema>;

export const regionSchema = z.object({ name, entityId: id.nullish(), parentId: id.nullish() });
export type RegionInput = z.infer<typeof regionSchema>;

export const locationSchema = z.object({ name, branchId: id, kind: z.enum(LOCATION_KINDS).optional() });
export type LocationInput = z.infer<typeof locationSchema>;

/** The people who hold one role at one branch (MANAGER, HR) or one region (AREA): the whole set, replaced. */
export const managersSchema = z
  .object({
    branchId: id.nullish(),
    regionId: id.nullish(),
    role: z.enum(MANAGER_ROLES),
    userIds: z.array(id).max(50),
  })
  .refine((m) => Boolean(m.branchId) !== Boolean(m.regionId), 'Name a branch or a region, not both')
  .refine(
    (m) => (m.role === 'AREA') === Boolean(m.regionId),
    'Area managers belong to a region; managers and HR to a branch',
  );
export type ManagersInput = z.infer<typeof managersSchema>;

/** Where a person works: the home branch and any others. */
export const personBranchesSchema = z.object({
  homeBranchId: id.nullish(),
  alsoBranchIds: z.array(id).max(60),
});

export const departmentHeadSchema = z.object({ departmentId: id, branchId: id, userId: id.nullable() });

/**
 * One step of an approval chain (decision 14: the owner decides who approves). `who` is a kind of person found
 * from the request — the requester's branch manager, department head … — or one named person.
 */
export const APPROVER_KINDS = [
  'branch_manager',
  'area_manager',
  'department_head',
  'branch_hr',
  'hr',
  'owner',
  'user',
] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];
export const approvalStepSchema = z
  .strictObject({
    who: z.enum(APPROVER_KINDS),
    /** `who: 'user'`: the person. */
    userId: id.optional(),
    /** Nobody holds the place (a branch with no manager): go to the next step. Off = the request waits here. */
    skipIfEmpty: z.boolean().optional(),
    /** No answer after this many hours: the next step may decide too. */
    escalateAfterHours: z.number().int().min(1).max(720).optional(),
    /** Only for requests of at least this amount (stock adjustments, purchases); smaller ones skip the step. */
    fromAmount: z.number().min(0).optional(),
  })
  .refine((s) => (s.who === 'user') === Boolean(s.userId), 'Choose the person');
export type ApprovalStep = z.infer<typeof approvalStepSchema>;

/** What can be routed. Each module asks for its kind when a request needs a decision. */
export const APPROVAL_KINDS = ['hr.leave', 'hr.correction', 'ims.adjustment', 'slip', 'ticket'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const approvalRouteSchema = z.object({
  kind: z.enum(APPROVAL_KINDS),
  /** Both empty = the group's chain; one set = an override for that entity or branch. */
  entityId: id.nullish(),
  branchId: id.nullish(),
  steps: z.array(approvalStepSchema).min(1, 'Add at least one step').max(6),
});
export type ApprovalRouteInput = z.infer<typeof approvalRouteSchema>;

/** The chain used when the owner has set none: the branch manager, else the department head, else the owner. */
export const DEFAULT_APPROVAL_STEPS: ApprovalStep[] = [
  { who: 'branch_manager', skipIfEmpty: true },
  { who: 'department_head', skipIfEmpty: true },
  { who: 'owner' },
];
