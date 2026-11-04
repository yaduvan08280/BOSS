import { z } from 'zod';

/** CLAUDE.md §9.1 — the 7-step HR Rules wizard. Every answer has the default shown there. */
export const lateRulesSchema = z.object({
  /** 1. Grace minutes late before it counts (0/10/15/30) */
  graceMinutes: z.number().int().min(0).max(120).default(15),
  /** 1. How late makes a half day (60/120/150/240 minutes) */
  halfDayAfterMinutes: z.number().int().min(15).max(600).default(150),
  /** 1. Hours of work for a full day (4/6/8) */
  fullDayHours: z.number().min(1).max(16).default(8),
  /** 1. Forgets to punch out → half day until a correction, or punch out at shift end */
  missedPunchOut: z.enum(['halfDay', 'shiftEnd']).default('halfDay'),
});

export const punchRulesSchema = z.object({
  /** 2. Punch away from the office */
  awayFromOffice: z.enum(['block', 'flag']).default('block'),
  /** 2. Phone location can't be read */
  noLocation: z.enum(['block', 'flag']).default('flag'),
  /** 2. Selfie when punching */
  selfie: z.boolean().default(false),
  /** 2. Forgotten punches someone can fix in a month (0/2/3/5) */
  correctionsPerMonth: z.number().int().min(0).max(31).default(3),
  /** 2. Count overtime, and after how many minutes past shift end (0/15/30/60) */
  overtime: z.boolean().default(true),
  overtimeAfterMinutes: z.number().int().min(0).max(240).default(30),
});

export const BUDDY_SOURCES = ['fmsBackup', 'defaultBuddy', 'sameDepartment', 'hod'] as const;
export type BuddySource = (typeof BUDDY_SOURCES)[number];

export const hrRulesSchema = z.object({
  late: lateRulesSchema.default(lateRulesSchema.parse({})),
  punches: punchRulesSchema.default(punchRulesSchema.parse({})),
  /** 3. Leave & HR */
  leave: z
    .object({
      yearStartMonth: z.union([z.literal(1), z.literal(4)]).default(4),
      compOffValidDays: z.number().int().min(1).max(365).default(60),
      hrUserId: z.string().nullish(),
      noticeDays: z.number().int().min(0).max(180).default(30),
    })
    .default({ yearStartMonth: 4, compOffValidDays: 60, noticeDays: 30 }),
  /** 4. Buddy */
  buddy: z
    .object({
      noBuddy: z.enum(['block', 'warn', 'off']).default('warn'),
      needsBuddy: z.enum(['any', 'fullDay', 'days']).default('any'),
      needsBuddyDays: z.number().min(1).max(30).default(2),
      otherDepartment: z.boolean().default(false),
      maxCover: z.number().int().min(1).max(10).default(3),
    })
    .default({ noBuddy: 'warn', needsBuddy: 'any', needsBuddyDays: 2, otherDepartment: false, maxCover: 3 }),
  /** 5. Buddy's answer */
  buddyAnswer: z
    .object({
      order: z
        .array(z.enum(BUDDY_SOURCES))
        .length(4)
        .default([...BUDDY_SOURCES]),
      answerHours: z.number().min(1).max(72).default(4),
      onReturn: z.enum(['notStarted', 'all', 'keep']).default('notStarted'),
      absentConfirmHours: z.number().min(1).max(24).default(2),
    })
    .default({ order: [...BUDDY_SOURCES], answerHours: 4, onReturn: 'notStarted', absentConfirmHours: 2 }),
  /** 6. Autopilot */
  autopilot: z
    .object({
      autoPick: z.boolean().default(false),
      autoApproveShort: z.boolean().default(false),
      absentToBuddy: z.boolean().default(false),
      morningReport: z.boolean().default(true),
      morningReportAt: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default('08:30'),
    })
    .default({
      autoPick: false,
      autoApproveShort: false,
      absentToBuddy: false,
      morningReport: true,
      morningReportAt: '08:30',
    }),
  /** "Different for a team or person": attendance answers that differ for one department or one person. */
  overrides: z
    .array(
      z.object({
        scope: z.enum(['department', 'person']),
        id: z.string(),
        late: overrideOf(lateRulesSchema).default({}),
        punches: overrideOf(punchRulesSchema).default({}),
      }),
    )
    .max(200)
    .default([]),
});
export type HrRules = z.infer<typeof hrRulesSchema>;
export type LateRules = z.infer<typeof lateRulesSchema>;
export type PunchRules = z.infer<typeof punchRulesSchema>;

export const DEFAULT_HR_RULES: HrRules = hrRulesSchema.parse({});

/**
 * An override's answers: every field optional and WITHOUT its default. (zod's `.partial()` still fills
 * defaults in, so one changed answer would reset all the others to the default.)
 */
export function overrideOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([k, v]) => [
      k,
      (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : (v as z.ZodType)).optional(),
    ]),
  );
  return z.object(shape) as unknown as ReturnType<z.ZodObject<S>['partial']>;
}

/** The attendance rules for one person: company answers, then their department's, then their own. */
export function rulesFor(
  rules: HrRules,
  person: { id: string; departmentId: string | null },
): { late: LateRules; punches: PunchRules } {
  const dept = rules.overrides.find((o) => o.scope === 'department' && o.id === person.departmentId);
  const own = rules.overrides.find((o) => o.scope === 'person' && o.id === person.id);
  return {
    late: { ...rules.late, ...dept?.late, ...own?.late },
    punches: { ...rules.punches, ...dept?.punches, ...own?.punches },
  };
}
