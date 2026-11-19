/**
 * Change APP_SECRET without losing the saved keys (bot token, AI key, WhatsApp, Drive, webhooks, gateways).
 * On the server (see deploy/RUNBOOK.md → "A key leaked"):
 *   ./deploy/compose.sh exec -e NEW_APP_SECRET=<new> api node apps/api/dist/rotate-secret.js
 * The running APP_SECRET is the old one. Afterwards put the new value in .env and restart: everyone signs in
 * again, and public links made from the secret (an outlet's pulse QR) must be printed again.
 */
import { createPrisma } from '@mono/db';
import { rotateSecrets } from '@mono/api/services';

const oldSecret = process.env.OLD_APP_SECRET ?? process.env.APP_SECRET ?? '';
const newSecret = process.env.NEW_APP_SECRET ?? '';
if (!oldSecret || !newSecret) {
  console.error('Set NEW_APP_SECRET (and OLD_APP_SECRET if it is not the running APP_SECRET).');
  process.exit(2);
}
const prisma = createPrisma();
try {
  const counts = await rotateSecrets(prisma, oldSecret, newSecret);
  console.log('Re-sealed with the new APP_SECRET:');
  for (const [name, n] of Object.entries(counts)) console.log(`  ${name}: ${n}`);
  console.log(
    '\nNow put the new APP_SECRET in .env and restart the stack. Keep it in your password manager.',
  );
} catch (err) {
  console.error((err as Error).message);
  console.error('Nothing was changed.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
