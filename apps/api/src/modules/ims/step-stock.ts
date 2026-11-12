import type { Db, FmsRecord, Tx } from '@mono/db';
import { mergeData, nextStepKey, type FlowDefinition, type FlowStep } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { log, mayDo, parseDefinition, recordData } from '../fms/engine-helpers';
import type { Actor } from '../work/actor';
import { askApprovers } from './access';
import { itemResolver, type RawLine } from './item-lines';
import { applyMove, show } from './moves';
import { reverseStock } from './step-reversal';

/**
 * Stock on steps (phase 11, §2.4): any step can issue, receive or transfer the record's item lines when it is
 * done, in the same transaction. One plan (`planStock`) feeds both the preview and what really happens.
 */
type Place = { fixed?: string; field?: string };
export type StockSpec = {
  action: 'ISSUE' | 'RECEIVE' | 'TRANSFER';
  itemsField?: string;
  from?: Place;
  to?: Place;
  /** Not enough stock: refuse the step · let it pass and ask an approver · note it and go on (AUTO steps). */
  short: 'block' | 'flag' | 'note';
};
export type Rec = Pick<FmsRecord, 'id' | 'companyId' | 'title' | 'number'>;

/** What a step does to stock: its `stock` setting, or an AUTO step's `auto.action = 'stock'` (never stops a record). */
export function stockSpecOf(step: FlowStep): StockSpec | null {
  if (step.type === 'AUTO') {
    const a = step.auto;
    if (a?.action !== 'stock') return null;
    return { action: a.direction === 'IN' ? 'RECEIVE' : 'ISSUE', itemsField: a.itemsField, short: 'note' };
  }
  return step.stock ?? null;
}

const placeOf = (p: Place | undefined, data: Record<string, unknown>) => {
  if (p?.fixed?.trim()) return p.fixed.trim();
  const v = p?.field ? data[p.field] : null;
  return (typeof v === 'string' || typeof v === 'number') && String(v).trim()
    ? String(v).trim().slice(0, 80)
    : null;
};

export type PlanLine = {
  /** The line as written. */
  text: string;
  /** null = not in the item master: this line moves nothing. */
  itemId: string | null;
  code: string | null;
  name: string;
  unit: string | null;
  qty: number;
  /** Rupees, as typed on the line. */
  rate: number;
  /** Stock when this line's turn comes (earlier lines of the same item counted), and after it. */
  stock: number | null;
  after: number | null;
  short: boolean;
  shortBy: number;
  from: string | null;
  to: string | null;
  itemRate: bigint | null;
};
export type StockPlan = {
  action: StockSpec['action'];
  short: StockSpec['short'];
  lines: PlanLine[];
  /** Something the doer must fix before the step can be done (a transfer with nowhere to go). */
  problem: string | null;
  /** The step would be refused as things stand. */
  blocked: boolean;
};

/** What a step would move, for the values so far. Reads only. */
export async function planStock(
  db: Db | Tx,
  companyId: string,
  def: FlowDefinition,
  step: FlowStep,
  data: Record<string, unknown>,
): Promise<StockPlan | null> {
  const spec = stockSpecOf(step);
  if (!spec) return null;
  const fields = [...def.startFields, ...def.steps.flatMap((s) => s.fields)].filter(
    (f) => f.type === 'items',
  );
  const field = spec.itemsField ? fields.find((f) => f.key === spec.itemsField) : fields[0];
  const raw = field && Array.isArray(data[field.key]) ? (data[field.key] as RawLine[]) : [];
  const typed = raw.filter((l) => String(l?.item ?? '').trim() && Number(l?.qty) > 0);
  const items = await itemResolver(db, companyId, typed);
  const from = placeOf(spec.from, data);
  const to = placeOf(spec.to, data);
  const running = new Map<string, number>();
  const lines = typed.map((l): PlanLine => {
    const text = String(l.item).trim();
    const qty = Number(l.qty);
    const rate = Number(l.rate) || 0;
    const item = items.find(l);
    if (!item)
      return {
        ...{ text, itemId: null, code: null, name: text, unit: null, qty, rate, itemRate: null },
        ...{ stock: null, after: null, short: false, shortBy: 0, from, to },
      };
    const stock = running.get(item.id) ?? Number(item.stock);
    const short = spec.action === 'ISSUE' && qty > stock;
    const after = spec.action === 'ISSUE' ? (short ? stock : stock - qty) : stock;
    running.set(item.id, spec.action === 'RECEIVE' ? stock + qty : after);
    return {
      ...{ text, itemId: item.id, code: item.code, name: item.name, unit: item.unit, qty, rate },
      ...{ stock, after: running.get(item.id)!, short, shortBy: short ? qty - stock : 0 },
      from: spec.action === 'TRANSFER' ? (from ?? item.location) : from,
      to,
      itemRate: item.rate,
    };
  });
  const problem = spec.action === 'TRANSFER' && lines.length && !to ? 'Say where the stock moves to' : null;
  const blocked = Boolean(problem) || (spec.short === 'block' && lines.some((l) => l.short));
  return { action: spec.action, short: spec.short, lines, problem, blocked };
}

/**
 * Move a step's stock. `block`: any short line refuses the step (nothing moves). `flag`: a short line waits as a
 * PENDING move for an approver (decision 75). `note`: it is written on the record and skipped (AUTO steps).
 * A line that is not in the item master never moves and is noted.
 */
export async function applyStepStock(
  tx: Tx,
  a: {
    record: Rec;
    def: FlowDefinition;
    step: FlowStep;
    data: Record<string, unknown>;
    stepId: string | null;
    actorId: string | null;
  },
): Promise<{ note: string; moved: number; pending: number } | null> {
  const { record, step } = a;
  const plan = await planStock(tx, record.companyId, a.def, step, a.data);
  if (!plan) return null;
  if (!plan.lines.length) return { note: 'No item lines to post', moved: 0, pending: 0 };
  if (plan.problem) throw new AppError(400, 'VALIDATION_FAILED', plan.problem);
  const firstShort = plan.lines.find((l) => l.short);
  if (plan.short === 'block' && firstShort)
    throw new AppError(
      409,
      'CONFLICT',
      `Not enough stock: ${firstShort.name} is short by ${show(firstShort.shortBy)} ${firstShort.unit} ` +
        `(${show(firstShort.qty)} needed, ${show(firstShort.stock ?? 0)} in stock)`,
      { item: firstShort.name, shortBy: firstShort.shortBy },
    );
  const ctx = { companyId: record.companyId, actorId: a.actorId };
  const label = `${record.title} #${record.number} · ${step.name}`;
  const notes: string[] = [];
  const waiting: string[] = [];
  let moved = 0;
  for (const l of plan.lines) {
    if (!l.itemId) {
      notes.push(`${l.text}: not in the item master`);
      continue;
    }
    const base = {
      ...{ itemId: l.itemId, note: label, refType: 'fms_record', refId: record.id },
      ...{ stepId: a.stepId, lineQty: l.qty, fromLocation: l.from, toLocation: l.to },
    };
    try {
      if (plan.action === 'ISSUE') await applyMove(tx, ctx, { ...base, type: 'OUT', delta: -l.qty });
      else if (plan.action === 'TRANSFER') await applyMove(tx, ctx, { ...base, type: 'TRANSFER', delta: 0 });
      else {
        // An item with no rate yet takes the rate of the line that brings it in.
        const rate = !l.itemRate && l.rate > 0 ? BigInt(Math.round(l.rate * 100)) : null;
        await applyMove(tx, ctx, { ...base, type: 'IN', delta: l.qty, rate });
      }
      moved++;
    } catch (e) {
      // Only "not enough stock" is handled here; it changed nothing, so the transaction is still good.
      if (!(e instanceof AppError) || e.code !== 'CONFLICT' || plan.short === 'block') throw e;
      if (plan.short === 'note') {
        notes.push(e.message);
        continue;
      }
      const held = await tx.stockMove.create({
        data: {
          ...{ companyId: record.companyId, itemId: l.itemId, type: 'OUT', qty: -l.qty, lineQty: l.qty },
          ...{ rate: l.itemRate, status: 'PENDING', createdById: a.actorId, stepId: a.stepId },
          ...{ refType: 'fms_record', refId: record.id, fromLocation: l.from, toLocation: l.to },
          note: `Not enough stock · ${label}`,
        },
      });
      await askApprovers(tx, ctx, held.id, {
        item: l.name,
        qty: `-${show(l.qty)} ${l.unit}`,
        reason: `not enough stock · ${label}`,
      });
      waiting.push(l.name);
    }
  }
  const head =
    plan.action === 'ISSUE'
      ? 'Stock out'
      : plan.action === 'RECEIVE'
        ? 'Stock in'
        : `Stock moved to ${plan.lines[0]!.to}`;
  const note = [
    `${head}: ${moved} line(s)`,
    ...(waiting.length ? [`${waiting.length} waiting for approval (${waiting.join(', ')})`] : []),
    ...notes,
  ].join(' · ');
  return { note, moved, pending: waiting.length };
}

/**
 * Called by the engine when a step is finished (same transaction). A rejected approval undoes the stock of the
 * steps it sends the record back over; any other finished step moves its own stock. AUTO steps move theirs when
 * they run (`runAuto`).
 */
export async function stockOnStepDone(
  tx: Tx,
  a: {
    record: FmsRecord;
    def: FlowDefinition;
    step: FlowStep;
    stepId: string;
    data: Record<string, unknown>;
    decision: string | null;
    actorId: string;
  },
) {
  const { record, step, def } = a;
  if (step.type === 'APPROVAL' && a.decision === 'rejected') {
    const from = def.steps.findIndex((s) => s.key === nextStepKey(def, step.key, 'rejected'));
    const upTo = def.steps.findIndex((s) => s.key === step.key);
    if (from < 0) return;
    const rows = await tx.fmsRecordStep.findMany({
      where: { recordId: record.id, position: { gte: from, lte: upTo } },
      select: { id: true },
    });
    await reverseStock(tx, record, {
      stepIds: rows.map((r) => r.id),
      why: `${step.name}: rejected`,
      actorId: a.actorId,
    });
    return;
  }
  if (step.type === 'AUTO') return;
  const done = await applyStepStock(tx, { ...a, record, def, step });
  if (!done) return;
  await log(tx, record, 'note', { stepKey: step.key, actorId: a.actorId, note: done.note });
  await writeAudit(
    tx,
    { companyId: record.companyId, actorId: a.actorId },
    { action: 'ims.step_stock', entityType: 'fms_step', entityId: a.stepId, after: done },
  );
}

/** Before "Mark done": what this open step would move for the values typed so far (L15). */
export async function previewStepStock(db: Db, actor: Actor, stepId: string, typed: Record<string, unknown>) {
  return db.$transaction(async (tx) => {
    const row = await tx.fmsRecordStep.findFirst({ where: { id: stepId, companyId: actor.companyId } });
    if (!row) throw notFound('Step');
    if (row.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This step is already done');
    const record = await tx.fmsRecord.findUniqueOrThrow({ where: { id: row.recordId } });
    const flow = await tx.flow.findUniqueOrThrow({ where: { id: record.flowId } });
    if (!mayDo(actor, flow, row.doerId)) throw new AppError(403, 'FORBIDDEN', 'This step is not yours');
    const version = await tx.flowVersion.findUniqueOrThrow({ where: { id: record.flowVersionId } });
    const def = parseDefinition(version.definition);
    const step = def.steps.find((s) => s.key === row.stepKey);
    if (!step) return { stock: null };
    const data = mergeData(await recordData(tx, record), typed);
    const plan = await planStock(tx, actor.companyId, def, step, data);
    if (!plan) return { stock: null };
    return {
      stock: { ...plan, lines: plan.lines.map(({ itemRate: _rate, rate: _typed, ...l }) => l) },
    };
  });
}
