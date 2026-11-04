import type { Db } from '@mono/db';
import { payRulesSchema } from '@mono/shared';

/** Gross monthly salary (₹) by designation; owners have none. */
const MONTHLY: Record<string, number> = {
  'Production Head': 70_000,
  'Maintenance Head': 65_000,
  'Purchase Manager': 55_000,
  'Admin Manager': 45_000,
  'HR Manager': 50_000,
  'Dispatch Manager': 48_000,
  'Quality Manager': 52_000,
  'Sales Manager': 60_000,
  'Logistics Manager': 50_000,
  'Marketing Manager': 55_000,
  'IT Administrator': 45_000,
  'Sales Executive': 30_000,
  Accountant: 32_000,
  'Store Keeper': 22_000,
};

/**
 * Pay demo (phase 7 payroll): everyone's pay — monthly salaries, daily wages for operators and fitters,
 * one hourly inspector, one person on 8 hours a day and one on 48 hours a week — plus the pay rules
 * (calendar month, Sundays paid, a Sunday worked pays a day extra, operators twice) and leave by designation.
 * Added once.
 */
export async function seedDemoPay(db: Db, companyId: string): Promise<boolean> {
  if (await db.payRules.findUnique({ where: { companyId } })) return false;
  const people = await db.user.findMany({
    where: { companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, name: true, designation: { select: { id: true, name: true } } },
  });
  const titleId = async (name: string) =>
    (await db.designation.findFirst({ where: { companyId, name, deletedAt: null } }))?.id;
  const operator = await titleId('Machine Operator');
  const salesExec = await titleId('Sales Executive');

  for (const p of people) {
    const title = p.designation?.name ?? '';
    const terms =
      p.name === 'Nikhil Sharma'
        ? { pattern: 'weekly', weeklyHours: 48, payBasis: 'monthly', rate: 45_000 }
        : p.name === 'Neha Kapoor'
          ? { pattern: 'daily', dailyHours: 8, latestStartMin: 11 * 60, payBasis: 'monthly', rate: 55_000 }
          : title === 'Quality Inspector'
            ? { pattern: 'shift', payBasis: 'hourly', rate: 150 }
            : title === 'Machine Operator'
              ? { pattern: 'shift', payBasis: 'daily', rate: 750 }
              : title === 'Fitter'
                ? { pattern: 'shift', payBasis: 'daily', rate: 800 }
                : MONTHLY[title]
                  ? { pattern: 'shift', payBasis: 'monthly', rate: MONTHLY[title]! }
                  : p.name === 'Ravi Kumar'
                    ? { pattern: 'shift', payBasis: 'monthly', rate: 20_000 }
                    : null;
    if (!terms) continue;
    const { rate, ...rest } = terms;
    await db.employeeTerms.create({ data: { companyId, userId: p.id, ...rest, rate: BigInt(rate * 100) } });
  }

  const rules = payRulesSchema.parse({
    monthDays: 'calendar',
    paidOffDays: true,
    dayOffWork: 'multiplier',
    dayOffMultiplier: 1,
    overtimePay: true,
    overtimeMultiplier: 2,
    lateEvery: 3,
    lateCutDays: 0.5,
    overrides: operator ? [{ scope: 'designation', id: operator, rules: { dayOffMultiplier: 2 } }] : [],
  });
  await db.payRules.create({ data: { companyId, rules: rules as object } });

  const cl = await db.leaveType.findFirst({ where: { companyId, code: 'CL' } });
  if (cl)
    await db.leaveQuota.createMany({
      data: [
        ...(operator ? [{ scope: 'designation', refId: operator, yearlyQuota: 6 }] : []),
        ...(salesExec ? [{ scope: 'designation', refId: salesExec, yearlyQuota: 10 }] : []),
      ].map((q) => ({ ...q, companyId, leaveTypeId: cl.id })),
    });
  return true;
}
