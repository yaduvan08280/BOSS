/**
 * Minimal seed: one company with built-in roles, a default shift and its owner.
 * Values come from SEED_* in .env. Safe to run again (does nothing if the company exists).
 * Demo / GGM seeds (`seed:demo`, `seed:ggm`) arrive in Phase 1.
 */
import 'dotenv/config';
import { createPrisma } from '@mono/db';
import { bootstrapCompany } from '@mono/api/services';

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set. Add it to .env (see .env.example).`);
  return v;
}

const prisma = createPrisma();
try {
  const { company, owner, created } = await bootstrapCompany(prisma, {
    companyName: required('SEED_COMPANY_NAME'),
    ownerName: process.env.SEED_OWNER_NAME?.trim() || 'Owner',
    ownerMobile: process.env.SEED_OWNER_MOBILE?.trim() || null,
    ownerEmail: process.env.SEED_OWNER_EMAIL?.trim() || null,
    ownerPassword: required('SEED_OWNER_PASSWORD'),
  });
  if (created) {
    console.log(
      `Created company "${company.name}" and owner ${owner?.code} (${owner?.mobile ?? owner?.email}).`,
    );
  } else {
    console.log(`Company "${company.name}" already exists — nothing to do.`);
  }
} finally {
  await prisma.$disconnect();
}
