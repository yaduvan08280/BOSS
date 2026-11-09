import type { Db } from '@mono/db';
import { AppError } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { identifierWhere } from '../../lib/identifier';
import { hashPassword } from '../../lib/password';
import { revokeSessions, tempPassword } from '../org/users.service';

/**
 * Server-side login recovery (`reset-password` command), for when nobody in the app can help — usually
 * the only Owner, since only an Owner may reset an Owner's password and the login page has no reset.
 * Gives the person a new one-time password (they must choose their own at the next sign-in), turns
 * their login on and signs them out everywhere. Written to the audit log with no actor (`via: server`).
 * `company` (slug or id) picks the company when the same mobile/email is used in more than one.
 */
export async function recoverLogin(db: Db, input: { identifier: string; company?: string | null }) {
  const where = identifierWhere(input.identifier);
  if (!where) throw new AppError(400, 'BAD_REQUEST', `"${input.identifier}" is not a mobile number or email`);
  const company = input.company?.trim();
  const people = await db.user.findMany({
    where: {
      ...where,
      deletedAt: null,
      company: { deletedAt: null, ...(company ? { OR: [{ slug: company }, { id: company }] } : {}) },
    },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      companyId: true,
      role: { select: { name: true } },
      company: { select: { name: true, slug: true } },
    },
    take: 20,
  });
  if (people.length === 0)
    throw new AppError(
      404,
      'NOT_FOUND',
      `Nobody${company ? ` in "${company}"` : ''} uses ${input.identifier}`,
    );
  if (people.length > 1)
    throw new AppError(
      409,
      'CHOOSE_COMPANY',
      `${input.identifier} is used in more than one company. Add --company with one of: ${people
        .map((p) => `${p.company.slug} (${p.company.name})`)
        .join(', ')}`,
    );
  const person = people[0]!;
  if (person.status !== 'ACTIVE')
    throw new AppError(
      409,
      'CONFLICT',
      `${person.name} is marked ${person.status.toLowerCase()}; an Owner can make them active again in the app`,
    );

  const password = tempPassword();
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: person.id },
      data: { passwordHash, mustChangePassword: true, loginEnabled: true },
    });
    await revokeSessions(tx, [person.id]);
    await recordChange(
      tx,
      { companyId: person.companyId, actorId: null },
      { event: 'user.password_reset', entityType: 'user', entityId: person.id, payload: { via: 'server' } },
    );
  });
  return {
    person: { code: person.code, name: person.name, role: person.role.name },
    company: person.company,
    tempPassword: password,
  };
}
