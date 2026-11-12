import type { Db } from '@mono/db';

/**
 * Phase 12M demo data: the GST rates an Indian company starts with, the usual ways money is taken, and two
 * vendors in the party list. Invoices and receipts are not made here: the worker carries the demo CRM orders and
 * payments over into bills by itself (decision 143). Added once.
 */
export async function seedDemoMoney(db: Db, companyId: string): Promise<boolean> {
  if (await db.taxRate.count({ where: { companyId } })) return false;
  await db.taxRate.createMany({
    data: [5, 12, 18, 28].map((percent) => ({
      companyId,
      code: `GST${percent}`,
      name: `GST ${percent}%`,
      percent,
      from: '2017-07-01',
    })),
  });
  await db.paymentMode.createMany({
    data: [
      { name: 'Cash', kind: 'CASH' },
      { name: 'UPI', kind: 'UPI' },
      { name: 'Card', kind: 'CARD' },
      { name: 'Bank transfer', kind: 'BANK' },
    ].map((m) => ({ companyId, ...m })),
  });
  const taken = await db.party.count({ where: { companyId, code: { startsWith: 'PTY-' } } });
  await db.party.createMany({
    data: [
      { name: 'Shree Resin Suppliers', state: 'Gujarat', taxId: '24AAACS1234F1Z3', creditDays: 30 },
      { name: 'Kishangarh Packaging Co', state: 'Rajasthan', taxId: null, creditDays: 15 },
    ].map((p, i) => ({
      companyId,
      code: `PTY-${String(taken + i + 1).padStart(3, '0')}`,
      kinds: ['vendor'],
      ...p,
    })),
  });
  await db.counter.upsert({
    where: { companyId_key_fy: { companyId, key: 'party', fy: '' } },
    update: { value: { increment: 2 } },
    create: { companyId, key: 'party', fy: '', value: taken + 2 },
  });
  return true;
}
