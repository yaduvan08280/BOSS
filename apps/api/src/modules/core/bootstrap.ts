import { formatNumber, nextCounter, type Db } from '@mono/db';
import {
  BUILT_IN_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_THEME,
  hhmmToMinutes,
  normalizeMobile,
} from '@mono/shared';
import { recordChange } from '../../lib/events';
import { hashPassword } from '../../lib/password';

export type BootstrapInput = {
  companyName: string;
  ownerName: string;
  ownerMobile?: string | null;
  ownerEmail?: string | null;
  ownerPassword: string;
  timezone?: string;
};

const ROLE_NAMES: Record<(typeof BUILT_IN_ROLES)[number], string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  HOD: 'HOD',
  SUPERVISOR: 'Supervisor',
  EA: 'EA',
  MEMBER: 'Member',
};

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'company'
  );
}

/**
 * Create a company with its built-in roles, a default shift and its owner (login enabled).
 * Idempotent by slug: if the company exists, returns it untouched.
 */
export async function bootstrapCompany(db: Db, input: BootstrapInput) {
  const slug = slugify(input.companyName);
  const existing = await db.company.findUnique({ where: { slug } });
  if (existing) {
    const owner = await db.user.findFirst({ where: { companyId: existing.id, role: { key: 'OWNER' } } });
    return { company: existing, owner, created: false };
  }
  const mobile = input.ownerMobile ? normalizeMobile(input.ownerMobile) : null;
  if (input.ownerMobile && !mobile)
    throw new Error(`Owner mobile "${input.ownerMobile}" is not a valid number`);
  const email = input.ownerEmail?.trim().toLowerCase() || null;
  if (!mobile && !email) throw new Error('The owner needs a mobile number or an email to log in');
  const passwordHash = await hashPassword(input.ownerPassword);

  return db.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: input.companyName,
        slug,
        timezone: input.timezone ?? 'Asia/Kolkata',
        settings: { theme: DEFAULT_THEME, defaultLang: 'en', defaultThemeMode: 'system' },
      },
    });
    const roles = await Promise.all(
      BUILT_IN_ROLES.map((key) =>
        tx.role.create({
          data: {
            companyId: company.id,
            key,
            name: ROLE_NAMES[key],
            permissions: DEFAULT_ROLE_PERMISSIONS[key],
          },
        }),
      ),
    );
    await tx.shift.create({
      data: {
        companyId: company.id,
        name: 'General',
        startMin: hhmmToMinutes('09:00'),
        endMin: hhmmToMinutes('19:00'),
        isDefault: true,
      },
    });
    const code = formatNumber('EMP', await nextCounter(tx, company.id, 'user'));
    const owner = await tx.user.create({
      data: {
        companyId: company.id,
        code,
        name: input.ownerName,
        mobile,
        email,
        passwordHash,
        passwordChangedAt: new Date(),
        roleId: roles.find((r) => r.key === 'OWNER')!.id,
        loginEnabled: true,
      },
    });
    const ctx = { companyId: company.id, actorId: null };
    await recordChange(tx, ctx, {
      event: 'company.created',
      entityType: 'company',
      entityId: company.id,
      after: { name: company.name },
    });
    await recordChange(tx, ctx, {
      event: 'user.created',
      entityType: 'user',
      entityId: owner.id,
      after: { code, name: owner.name, role: 'OWNER' },
    });
    return { company, owner, created: true };
  });
}
