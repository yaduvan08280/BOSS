import { createId } from '@paralleldrive/cuid2';
import type { Bill, Prisma, Tx } from '@mono/db';
import { writeAudit } from '../../lib/audit';
import { emitEvent } from '../../lib/events';
import { seriesOf, type Letterhead } from '../branches/letterhead';
import type { Actor } from '../work/actor';

/**
 * The last step of issuing a paper: its number, and everything that carries the number.
 *
 * A series with no gaps is held by whoever took its last number until their transaction ends, so the time
 * between taking the number and the end of the transaction is time every other till spends waiting. The
 * voucher, the audit row and the event are therefore written first, without the number; then ONE statement
 * takes the number and writes it into the paper and into those three rows. `beforeNumber` lets the caller do
 * its own last pieces of work ahead of that statement, so that nothing but the commit follows it.
 */
export async function finishIssue(
  tx: Tx,
  actor: Actor,
  bill: Bill,
  p: {
    to: string;
    fy: string;
    prefix: string;
    lines: unknown[];
    head: Letterhead;
    /** Carried over from before the engine: keep this number, take none from the series. */
    number?: string;
    beforeNumber?: (bill: Bill) => Promise<void>;
  },
): Promise<Bill> {
  const voucherId = p.lines.length
    ? (
        await tx.voucher.create({
          data: {
            companyId: bill.companyId,
            entityId: bill.entityId,
            billId: bill.id,
            date: bill.date,
            narration: p.number ?? '',
            lines: p.lines as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        })
      ).id
    : null;
  const ctx = { companyId: bill.companyId, actorId: actor.userId };
  const auditId = createId();
  await writeAudit(tx, ctx, {
    id: auditId,
    action: 'bill.issued',
    entityType: 'bill',
    entityId: bill.id,
    after: { number: p.number ?? null, total: Number(bill.total) },
  });
  const event = await emitEvent(tx, ctx, {
    name: 'bill.issued',
    entityType: 'bill',
    entityId: bill.id,
    payload: {
      type: bill.type,
      number: p.number ?? null,
      partyId: bill.partyId,
      total: Number(bill.total),
      branchId: bill.branchId,
    },
  });
  if (p.number) {
    const issued = await tx.bill.update({
      where: { id: bill.id },
      data: { status: p.to, number: p.number, fy: p.fy, issuedAt: new Date() },
    });
    await p.beforeNumber?.(issued);
    return issued;
  }
  // One series per legal entity and kind of paper (a GSTIN's own invoice numbers); the company's own otherwise.
  const series = seriesOf('entity', p.head, `bill:${bill.type}`, p.prefix, p.fy);
  // What the paper looks like now (money set against other papers changed its `settled` a moment ago).
  const current = await tx.bill.findUniqueOrThrow({ where: { id: bill.id } });
  await p.beforeNumber?.(current);
  // "INV/RJ/26-27/" — the running number follows, at least four digits wide.
  const front = series.number(0).slice(0, -4);
  const rows = await tx.$queryRaw<{ number: string; issued_at: Date }[]>`
    WITH n AS (
      INSERT INTO counters (company_id, key, fy, value)
      VALUES (${bill.companyId}, ${series.counterKey}, ${p.fy}, 1)
      ON CONFLICT (company_id, key, fy) DO UPDATE SET value = counters.value + 1
      RETURNING value
    ), b AS (
      UPDATE bills SET status = ${p.to}, fy = ${p.fy}, issued_at = now(), updated_at = now(),
        number = ${front} || CASE WHEN n.value < 1000 THEN lpad(n.value::text, 4, '0') ELSE n.value::text END
      FROM n WHERE bills.id = ${bill.id}
      RETURNING bills.number, bills.issued_at
    ), v AS (
      UPDATE vouchers SET narration = b.number FROM b WHERE vouchers.id = ${voucherId}
    ), a AS (
      UPDATE audit_logs SET "after" = jsonb_set("after", '{number}', to_jsonb(b.number))
      FROM b WHERE audit_logs.id = ${auditId}
    ), e AS (
      UPDATE domain_events SET payload = jsonb_set(payload, '{number}', to_jsonb(b.number))
      FROM b WHERE domain_events.id = ${event.id}
    )
    SELECT number, issued_at FROM b`;
  const row = rows[0];
  if (!row) throw new Error('The paper could not be numbered');
  return {
    ...current,
    status: p.to,
    fy: p.fy,
    number: row.number,
    issuedAt: row.issued_at,
    updatedAt: row.issued_at,
  };
}
