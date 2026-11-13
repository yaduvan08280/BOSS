/**
 * Minimal seed: one company with built-in roles, a default shift and its owner.
 * Values come from SEED_* in .env. Safe to run again (does nothing if the company exists).
 * Runs on every deploy, so it also gives every company the notification rules and templates of new events.
 * Demo / GGM seeds (`seed:demo`, `seed:ggm`) arrive in Phase 1.
 */
import 'dotenv/config';
import { createPrisma } from '@mono/db';
import { bootstrapCompany, ensureNotifyDefaults, ensureRoleDefaults } from '@mono/api/services';

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
    console.log(`Company "${company.name}" already exists.`);
  }
  for (const c of await prisma.company.findMany({ select: { id: true, name: true } })) {
    // Modules added since the company was made: its built-in roles get their default rights (decision 115) —
    // every company on this install, not only the first.
    const roles = await prisma.$transaction((tx) => ensureRoleDefaults(tx, c.id));
    if (roles) console.log(`${c.name}: ${roles} built-in roles given the rights of newer modules.`);
    const added = await prisma.$transaction((tx) => ensureNotifyDefaults(tx, c.id));
    if (added.rules || added.templates)
      console.log(`${c.name}: added ${added.rules} notification rules, ${added.templates} templates.`);
  }
} finally {
  await prisma.$disconnect();
}
