import { randomInt } from 'node:crypto';
import type { Prisma, Tx } from '@mono/db';
import { formatNumber, nextCounter } from '@mono/db';
import { looksLikeEmail, normalizeMobile, type OrgPerson } from '@mono/shared';
import { AppError } from '../../lib/errors';

export const personInclude = {
  role: { select: { name: true, key: true } },
  designation: { select: { name: true } },
  mainDepartment: { select: { name: true } },
  reportsTo: { select: { name: true } },
  departments: { select: { departmentId: true } },
  hodOf: { where: { deletedAt: null }, select: { id: true } },
} satisfies Prisma.UserInclude;

type PersonRow = Prisma.UserGetPayload<{ include: typeof personInclude }>;

export function toPerson(u: PersonRow, withHr: boolean): OrgPerson {
  return {
    id: u.id,
    code: u.code,
    name: u.name,
    mobile: u.mobile,
    email: u.email,
    status: u.status,
    loginEnabled: u.loginEnabled,
    roleId: u.roleId,
    roleName: u.role.name,
    roleKey: u.role.key,
    mainDepartmentId: u.mainDepartmentId,
    designationId: u.designationId,
    designationName: u.designation?.name ?? null,
    mainDepartmentName: u.mainDepartment?.name ?? null,
    reportsToId: u.reportsToId,
    reportsToName: u.reportsTo?.name ?? null,
    branchId: u.branchId,
    shiftId: u.shiftId,
    alsoWorksIn: u.departments.map((d) => d.departmentId).filter((d) => d !== u.mainDepartmentId),
    hodOf: u.hodOf.map((d) => d.id),
    avatarUrl: u.avatarUrl,
    telegramLinked: Boolean(u.telegramChatId),
    ...(withHr ? { hr: (u.hr ?? {}) as Record<string, unknown> } : {}),
  };
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
/** Readable one-time password (no 0/O, 1/l/I), always with a digit. */
export function tempPassword(): string {
  let s = '';
  for (let i = 0; i < 9; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}${randomInt(10)}`;
}

export function cleanIdentifiers(input: { mobile?: string | null; email?: string | null }) {
  const mobile = input.mobile ? normalizeMobile(input.mobile) : null;
  if (input.mobile && !mobile)
    throw new AppError(400, 'VALIDATION_FAILED', 'Enter a valid mobile number', {
      fields: { mobile: 'Invalid' },
    });
  const email = input.email ? input.email.trim().toLowerCase() : null;
  if (email && !looksLikeEmail(email))
    throw new AppError(400, 'VALIDATION_FAILED', 'Enter a valid email', { fields: { email: 'Invalid' } });
  return { mobile, email };
}

/** Mobile and email are login IDs, so they must be unique within the company. */
export async function assertUnique(
  tx: Tx,
  ids: { mobile: string | null; email: string | null },
  exceptId?: string,
) {
  const or = [...(ids.mobile ? [{ mobile: ids.mobile }] : []), ...(ids.email ? [{ email: ids.email }] : [])];
  if (!or.length) return;
  const clash = await tx.user.findFirst({
    where: { OR: or, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true, mobile: true },
  });
  if (clash) {
    const field = ids.mobile && clash.mobile === ids.mobile ? 'mobile' : 'email';
    throw new AppError(409, 'CONFLICT', `${clash.name} already uses this ${field}`, {
      fields: { [field]: 'Taken' },
    });
  }
}

export async function nextUserCode(tx: Tx, companyId: string) {
  return formatNumber('EMP', await nextCounter(tx, companyId, 'user'));
}

export async function roleByKey(tx: Tx, key: string) {
  const role = await tx.role.findFirst({ where: { key, deletedAt: null } });
  if (!role) throw new AppError(500, 'INTERNAL', `Role ${key} is missing`);
  return role;
}

/** Never leave a company without an active Owner who can log in. */
export async function assertOwnerRemains(tx: Tx, userIds: string[]) {
  const owners = await tx.user.findMany({
    where: { role: { key: 'OWNER' }, deletedAt: null, status: 'ACTIVE', loginEnabled: true },
    select: { id: true },
  });
  if (owners.length > 0 && owners.every((o) => userIds.includes(o.id))) {
    throw new AppError(409, 'CONFLICT', 'The company needs at least one active Owner who can log in');
  }
}

export async function revokeSessions(tx: Tx, userIds: string[]) {
  await tx.session.updateMany({
    where: { userId: { in: userIds }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * The branch a new person starts at: the one named (it must exist), else the company's only branch — so nobody
 * is left without a place in a one-branch company — else none (the person shows as "no branch yet").
 */
export async function branchForNew(tx: Tx, branchId: string | null | undefined) {
  if (branchId) {
    if (!(await tx.branch.count({ where: { id: branchId, deletedAt: null } })))
      throw new AppError(404, 'NOT_FOUND', 'Branch not found');
    return branchId;
  }
  const live = await tx.branch.findMany({ where: { deletedAt: null }, select: { id: true }, take: 2 });
  return live.length === 1 ? live[0]!.id : null;
}
