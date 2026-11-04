import type { Tx } from '@mono/db';
import type { FlowDefinition, FlowStep } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { applyMove } from './moves';

type Line = { item?: unknown; qty?: unknown };

/**
 * An FMS AUTO "stock" step (§6.1, §10.3): the record's item lines go out of stock (or in). Lines name the
 * item by its code or its name. A line that can't be posted (unknown item, not enough stock) is noted on the
 * record and the rest still go: the record never gets stuck on stock.
 */
export async function fmsStockMoves(
  tx: Tx,
  record: { id: string; companyId: string; title: string; number: number },
  step: FlowStep,
  def: FlowDefinition,
  data: Record<string, unknown>,
): Promise<string> {
  const a = step.auto!;
  const fields = [...def.startFields, ...def.steps.flatMap((s) => s.fields)].filter(
    (f) => f.type === 'items',
  );
  const field = a.itemsField ? fields.find((f) => f.key === a.itemsField) : fields[0];
  const lines = field && Array.isArray(data[field.key]) ? (data[field.key] as Line[]) : [];
  if (!lines.length) return 'No item lines to post';
  const items = await tx.item.findMany({
    where: { companyId: record.companyId, deletedAt: null, active: true },
  });
  const find = (name: string) => {
    const k = name.trim().toLowerCase();
    return items.find((i) => i.code.toLowerCase() === k) ?? items.find((i) => i.name.toLowerCase() === k);
  };
  const way = a.direction ?? 'OUT';
  const notes: string[] = [];
  let posted = 0;
  for (const l of lines) {
    const name = String(l.item ?? '').trim();
    const qty = Number(l.qty);
    if (!name || !(qty > 0)) continue;
    const item = find(name);
    if (!item) {
      notes.push(`${name}: not in the item master`);
      continue;
    }
    try {
      await applyMove(
        tx,
        { companyId: record.companyId, actorId: null },
        {
          itemId: item.id,
          type: way,
          delta: way === 'IN' ? qty : -qty,
          note: `${record.title} #${record.number} · ${step.name}`,
          refType: 'fms_record',
          refId: record.id,
        },
      );
      posted++;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      notes.push(e.message);
    }
  }
  return [`Stock ${way === 'IN' ? 'in' : 'out'}: ${posted} line(s)`, ...notes].join(' · ');
}
