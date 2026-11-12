import type { Db } from '@mono/db';
import type { VoucherLine } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { can, type Actor } from '../work/actor';

/**
 * Vouchers for Tally (phase 12M, decision 17): MONO keeps each paper's books as balanced lines against its own
 * heads; a mapping says which Tally ledger each head is; the export is Tally's own XML, which the agent on the
 * Tally machine posts. A party's head goes to the ledger named like the party. A head with no ledger yet stops
 * the export and names itself — nothing is posted to a guessed ledger.
 */
const needAdmin = (a: Actor) => {
  if (!can(a, 'money.admin'))
    throw new AppError(403, 'FORBIDDEN', 'Only the accounts admin maps and exports');
};
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Heads that belong to a party: the ledger is the party itself. */
const PARTY_HEADS = new Set(['receivable', 'payable', 'advance_received']);
const TALLY_TYPE: Record<string, string> = {
  INVOICE: 'Sales',
  DEBIT_NOTE: 'Debit Note',
  CREDIT_NOTE: 'Credit Note',
  PURCHASE_BILL: 'Purchase',
  RECEIPT: 'Receipt',
  ADVANCE: 'Receipt',
  VENDOR_PAYMENT: 'Payment',
};

/** Every head the books have used, with its ledger (or none yet). */
export async function tallyMap(db: Db, actor: Actor) {
  needAdmin(actor);
  const [maps, vouchers] = await Promise.all([
    db.tallyMap.findMany({ where: { companyId: actor.companyId } }),
    db.voucher.findMany({ where: { companyId: actor.companyId }, select: { lines: true } }),
  ]);
  const used = new Set<string>();
  for (const v of vouchers)
    for (const l of v.lines as VoucherLine[]) if (!PARTY_HEADS.has(l.head)) used.add(l.head);
  const ledger = new Map(maps.map((m) => [m.head, m.ledger]));
  return [...new Set([...used, ...ledger.keys()])]
    .sort()
    .map((head) => ({ head, ledger: ledger.get(head) ?? null }));
}

export async function saveTallyMap(db: Db, actor: Actor, rows: { head: string; ledger: string | null }[]) {
  needAdmin(actor);
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const key = { companyId_head: { companyId: actor.companyId, head: r.head } };
      if (r.ledger?.trim())
        await tx.tallyMap.upsert({
          where: key,
          create: { companyId: actor.companyId, head: r.head, ledger: r.ledger.trim() },
          update: { ledger: r.ledger.trim() },
        });
      else await tx.tallyMap.deleteMany({ where: { companyId: actor.companyId, head: r.head } });
    }
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      { action: 'tally.map_saved', entityType: 'tally_map', entityId: actor.companyId, after: rows },
    );
  });
  return tallyMap(db, actor);
}

/** The vouchers of a period as Tally XML. Refused while a head it would use has no ledger. */
export async function tallyExport(
  db: Db,
  actor: Actor,
  q: { from: string; to: string; entityId?: string | null },
) {
  needAdmin(actor);
  const vouchers = await db.voucher.findMany({
    where: {
      companyId: actor.companyId,
      date: { gte: q.from, lte: q.to },
      ...(q.entityId ? { entityId: q.entityId } : {}),
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  const bills = new Map(
    (
      await db.bill.findMany({
        where: { id: { in: vouchers.map((v) => v.billId) } },
        select: { id: true, type: true, number: true },
      })
    ).map((b) => [b.id, b]),
  );
  const ledger = new Map(
    (await db.tallyMap.findMany({ where: { companyId: actor.companyId } })).map((m) => [m.head, m.ledger]),
  );
  const partyIds = new Set<string>();
  const unmapped = new Set<string>();
  for (const v of vouchers)
    for (const l of v.lines as VoucherLine[]) {
      if (PARTY_HEADS.has(l.head) && l.partyId) partyIds.add(l.partyId);
      else if (!ledger.has(l.head)) unmapped.add(l.head);
    }
  if (unmapped.size)
    throw new AppError(409, 'CONFLICT', 'Some heads have no Tally ledger yet', {
      heads: [...unmapped].sort(),
    });
  const partyName = new Map(
    (await db.party.findMany({ where: { id: { in: [...partyIds] } }, select: { id: true, name: true } })).map(
      (p) => [p.id, p.name],
    ),
  );
  const rupees = (minor: number) => (minor / 100).toFixed(2);
  const body = vouchers
    .map((v) => {
      const bill = bills.get(v.billId);
      const entries = (v.lines as VoucherLine[])
        .map((l) => {
          const name =
            PARTY_HEADS.has(l.head) && l.partyId ? (partyName.get(l.partyId) ?? l.head) : ledger.get(l.head)!;
          // Tally: a debit is a negative amount with ISDEEMEDPOSITIVE Yes; a credit is positive.
          const debit = l.debit > 0;
          return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? `-${rupees(l.debit)}` : rupees(l.credit)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
        })
        .join('');
      const type = v.reversal ? 'Journal' : (TALLY_TYPE[bill?.type ?? ''] ?? 'Journal');
      return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create"><DATE>${v.date.replace(/-/g, '')}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(bill?.number ?? v.id)}</VOUCHERNUMBER><NARRATION>${esc(v.narration)}</NARRATION>${entries}</VOUCHER></TALLYMESSAGE>`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${body}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  return { xml, count: vouchers.length };
}
