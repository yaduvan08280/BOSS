import type { Db, Tx } from '@mono/db';
import { addDays, DEFAULT_LEAVE_TYPES, leaveYearOf, payPolicyFor, zonedToUtc } from '@mono/shared';
import { hrRulesOf, type HrPerson } from './people';
import { payRulesOf, quotaFor } from './terms';

export async function ensureLeaveTypes(db: Db | Tx, companyId: string) {
  if (await db.leaveType.count({ where: { companyId } })) return;
  await db.leaveType.createMany({
    data: DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, companyId })),
    skipDuplicates: true,
  });
}

/** The leave period as instants; a half day is the first or second half of the shift. */
export function period(from: string, to: string, half: string | null | undefined, p: HrPerson, tz: string) {
  if (half) {
    const mid = Math.round((p.shift.start + p.shift.end) / 2);
    return half === 'FIRST'
      ? { fromAt: zonedToUtc(from, 0, tz), toAt: zonedToUtc(from, mid, tz) }
      : { fromAt: zonedToUtc(from, mid, tz), toAt: zonedToUtc(addDays(from, 1), 0, tz) };
  }
  return { fromAt: zonedToUtc(from, 0, tz), toAt: zonedToUtc(addDays(to, 1), 0, tz) };
}

/** Days left of each leave type this leave year (allotted + carried − taken − asked for). Comp-off = days earned in the last N days. */
export async function balancesOf(db: Db | Tx, companyId: string, userId: string, onDate: string) {
  await ensureLeaveTypes(db, companyId);
  const rules = await hrRulesOf(db, companyId);
  const year = leaveYearOf(onDate, rules.leave.yearStartMonth);
  const types = await db.leaveType.findMany({
    where: { companyId, deletedAt: null, active: true },
    orderBy: { code: 'asc' },
  });
  const user = await db.user.findFirst({
    where: { id: userId, companyId },
    select: { id: true, designationId: true, mainDepartmentId: true },
  });
  // Working a day off earns a comp-off only when that is the pay rule (else it is paid extra, or nothing).
  const earnsCompOff =
    payPolicyFor(await payRulesOf(db, companyId), {
      id: userId,
      departmentId: user?.mainDepartmentId ?? null,
      designationId: user?.designationId ?? null,
    }).dayOffWork === 'compOff';
  const out = [];
  for (const t of types) {
    // Their own number, else their designation's, else the leave type's.
    const quota = user ? await quotaFor(db, t, user) : Number(t.yearlyQuota);
    let b = await db.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId: t.id, year } },
    });
    if (!b) {
      const prev = await db.leaveBalance.findUnique({
        where: { userId_leaveTypeId_year: { userId, leaveTypeId: t.id, year: year - 1 } },
      });
      const left = prev ? Number(prev.allotted) + Number(prev.carried) - Number(prev.used) : 0;
      b = await db.leaveBalance.create({
        data: {
          companyId,
          userId,
          leaveTypeId: t.id,
          year,
          allotted: quota,
          carried: Math.max(0, Math.min(left, Number(t.carryForward))),
        },
      });
    }
    if (Number(b.allotted) !== quota && t.code !== 'CO')
      b = await db.leaveBalance.update({ where: { id: b.id }, data: { allotted: quota } });
    let allotted = Number(b.allotted);
    if (t.code === 'CO') {
      const since = addDays(onDate, -rules.leave.compOffValidDays);
      allotted = earnsCompOff
        ? await db.attendanceDay.count({
            where: { userId, compOff: true, date: { gte: since, lte: onDate } },
          })
        : 0;
    }
    const pending = await db.leaveRequest.aggregate({
      where: { userId, leaveTypeId: t.id, status: 'PENDING', from: { gte: `${year}-` } },
      _sum: { days: true },
    });
    const asked = Number(pending._sum.days ?? 0);
    out.push({
      leaveTypeId: t.id,
      code: t.code,
      name: t.name,
      paid: t.paid,
      allotted,
      carried: Number(b.carried),
      used: Number(b.used),
      pending: asked,
      available: allotted + Number(b.carried) - Number(b.used) - asked,
    });
  }
  return { year, balances: out };
}
