/**
 * `npm run seed:ggm` — GGM Minerals skeleton (CLAUDE.md §15): company profile, the three sites and the usual
 * departments. No people are invented; add them in System Master → Users. Safe to run again.
 * Creates the company with the SEED_OWNER_* owner from .env if it doesn't exist yet.
 */
import 'dotenv/config';
import { createPrisma } from '@mono/db';
import { bootstrapCompany } from '@mono/api/services';

const BRANCHES: [string, string, string][] = [
  ['Kishangarh plant', 'KSG', 'Kishangarh'],
  ['Tonk mines', 'TNK', 'Tonk'],
  ['Niwai factory', 'NWI', 'Niwai'],
];
const DEPARTMENTS = [
  'Management',
  'Accounts',
  'Sales',
  'Marketing',
  'Production',
  'Quality',
  'Dispatch',
  'Store',
  'Purchase',
  'Maintenance',
  'Mines',
  'HR',
  'IT',
  'Admin',
];
const COLORS = [
  '#E9A23B',
  '#2F5BD3',
  '#0F7B6C',
  '#B23A48',
  '#6E4BB8',
  '#5C8A2E',
  '#1695A3',
  '#D9822B',
  '#9C4F96',
  '#7A5C43',
];

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set. Add it to .env (see .env.example).`);
  return v;
}

const prisma = createPrisma();
try {
  const { company } = await bootstrapCompany(prisma, {
    companyName: 'GGM Minerals',
    ownerName: process.env.SEED_OWNER_NAME?.trim() || 'Owner',
    ownerMobile: process.env.SEED_OWNER_MOBILE?.trim() || null,
    ownerEmail: process.env.SEED_OWNER_EMAIL?.trim() || null,
    ownerPassword: required('SEED_OWNER_PASSWORD'),
  });
  const id = company.id;
  let added = 0;
  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id },
      data: {
        city: company.city ?? 'Kishangarh',
        state: company.state ?? 'Rajasthan',
        legalName: company.legalName ?? 'Goyal Group of Minerals',
      },
    });
    const branches = await tx.branch.findMany({ where: { companyId: id, deletedAt: null } });
    for (const [i, [name, code, city]] of BRANCHES.entries()) {
      if (branches.some((b) => b.name.toLowerCase() === name.toLowerCase())) continue;
      await tx.branch.create({
        data: {
          companyId: id,
          name,
          code,
          city,
          state: 'Rajasthan',
          isDefault: i === 0 && branches.length === 0,
        },
      });
      added++;
    }
    const depts = await tx.department.findMany({ where: { companyId: id, deletedAt: null } });
    for (const [i, name] of DEPARTMENTS.entries()) {
      if (depts.some((d) => d.name.toLowerCase() === name.toLowerCase())) continue;
      await tx.department.create({
        data: { companyId: id, name, sortOrder: depts.length + i, color: COLORS[i % COLORS.length] },
      });
      added++;
    }
  });
  console.log(
    added ? `GGM Minerals: added ${added} branches/departments.` : 'GGM Minerals skeleton already in place.',
  );
} finally {
  await prisma.$disconnect();
}
