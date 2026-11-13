import type { Folio, Stay, Tx } from '@mono/db';
import { routeFolio, type FolioKind, type Routing } from '@mono/shared';
import type { ActorContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import type { Hotel } from './core';

/**
 * Phase 17 — putting a charge on a stay. A stay has the guest's folio (no. 1) and may have more; a routing rule
 * sends kinds of charge to another folio (the room to the company, the extras to the guest).
 */
export type Charge = {
  kind: FolioKind;
  text: string;
  /** Minor units before tax, for the whole line. */
  amount: number;
  qty?: number;
  taxCode?: string | null;
  hsn?: string | null;
  refType?: string | null;
  refId?: string | null;
  /** Put it on this folio whatever the routing says. */
  folioNo?: number;
};

/** The open folio a kind of charge goes to: the routed one, else the guest's own, else any still open. */
export async function folioFor(tx: Tx, stay: Stay, kind: FolioKind, folioNo?: number): Promise<Folio> {
  const folios = await tx.folio.findMany({ where: { stayId: stay.id }, orderBy: { no: 'asc' } });
  const want = folioNo ?? routeFolio(stay.routing as Routing | null, kind);
  const open = folios.filter((f) => f.status === 'OPEN');
  const folio =
    open.find((f) => f.no === want) ?? (folioNo ? undefined : (open.find((f) => f.no === 1) ?? open[0]));
  if (!folio) throw new AppError(409, 'CONFLICT', 'That folio is closed — nothing more can be charged to it');
  return folio;
}

export async function postCharge(tx: Tx, ctx: ActorContext, hotel: Hotel, stay: Stay, c: Charge) {
  const folio = await folioFor(tx, stay, c.kind, c.folioNo);
  return tx.folioLine.create({
    data: {
      companyId: stay.companyId,
      folioId: folio.id,
      stayId: stay.id,
      day: hotel.businessDate,
      kind: c.kind,
      text: c.text,
      qty: c.qty ?? 1,
      amount: BigInt(c.amount),
      taxCode: c.taxCode ?? null,
      hsn: c.hsn ?? null,
      refType: c.refType ?? null,
      refId: c.refId ?? null,
      postedById: ctx.actorId,
    },
  });
}
