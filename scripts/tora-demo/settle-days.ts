// What the nightly attendance job does, for days before the demo company existed: settle every staff day of a
// range that has no row yet (no punch → absent, approved leave → on leave, holiday / weekly off as the calendar says).
// Run from the repo root: npx tsx scripts/tora-demo/settle-days.ts 2026-11-01 2026-11-13
import 'dotenv/config';
import { createPrisma } from '@mono/db';
import { hrPerson, settleDay } from '@mono/api/services';
import { addDays } from '@mono/shared';

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error('Give a first and last date');
const prisma = createPrisma();
const company = await prisma.company.findFirstOrThrow({ where: { slug: 'tora-skylongue' } });
const staff = await prisma.user.findMany({
  where: { companyId: company.id, deletedAt: null, status: 'ACTIVE', email: { endsWith: '@toraskylounge.demo' } },
  select: { id: true },
});
let n = 0;
for (const u of staff) {
  const p = await hrPerson(prisma, company.id, u.id);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (await prisma.attendanceDay.findUnique({ where: { userId_date: { userId: u.id, date: d } } })) continue;
    if ((await settleDay(prisma, company.id, p, d)).saved) n++;
  }
}
console.log('settled', n, 'days');
await prisma.$disconnect();
