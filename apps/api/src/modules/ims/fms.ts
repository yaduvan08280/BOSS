import type { Tx } from '@mono/db';
import type { FlowDefinition, FlowStep } from '@mono/shared';
import { applyStepStock } from './step-stock';

/**
 * An FMS AUTO "stock" step (§6.1, §10.3): the record's item lines go out of stock (or in). Lines name the item
 * by the id a picked line keeps, else by its code or its name. A line that can't be posted (unknown item, not
 * enough stock) is noted on the record and the rest still go: the record never gets stuck on stock (decision 81).
 * It runs through the same code as stock on any other step (`step-stock.ts`); `stepId` is the record's step row,
 * so the moves can be reversed with their step.
 */
export async function fmsStockMoves(
  tx: Tx,
  record: { id: string; companyId: string; title: string; number: number },
  step: FlowStep,
  def: FlowDefinition,
  data: Record<string, unknown>,
  stepId: string | null = null,
): Promise<string> {
  const done = await applyStepStock(tx, { record, def, step, data, stepId, actorId: null });
  return done?.note ?? 'No item lines to post';
}
