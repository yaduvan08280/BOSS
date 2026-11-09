/**
 * Locked out (e.g. the only Owner forgot their password)? Run on the server:
 *   ./deploy/compose.sh exec api node apps/api/dist/reset-password.js <mobile-or-email> [--company <slug>]
 * In development: npm run reset-password -- <mobile-or-email> [--company <slug>]
 *
 * Prints a new one-time password (shown only now). The person must choose their own at the next sign-in;
 * every device they were signed in on is signed out. See deploy/INSTALL.md → Troubleshooting.
 */
import { createPrisma } from '@mono/db';
import { recoverLogin } from '@mono/api/services';

const USAGE = 'Usage: reset-password <mobile-or-email> [--company <slug>]';

function parseArgs(argv: string[]) {
  let identifier: string | undefined;
  let company: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--company') company = argv[++i];
    else if (a.startsWith('--company=')) company = a.slice('--company='.length);
    else if (a === '--help' || a === '-h') return null;
    else if (!identifier) identifier = a;
    else return null;
  }
  return identifier ? { identifier, company } : null;
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.error(USAGE);
  process.exit(2);
}

const prisma = createPrisma();
try {
  const r = await recoverLogin(prisma, args);
  console.log(
    [
      `Company:  ${r.company.name} (${r.company.slug})`,
      `Person:   ${r.person.name} · ${r.person.code} · ${r.person.role}`,
      `Login ID: ${args.identifier}`,
      `One-time password: ${r.tempPassword}`,
      '',
      'Shown only now. They are signed out everywhere and must choose a new password at the next sign-in.',
    ].join('\n'),
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
