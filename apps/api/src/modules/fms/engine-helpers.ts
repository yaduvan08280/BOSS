import type { FmsRecord, Flow, Tx } from '@mono/db';
import {
  flowDefinitionSchema,
  mergeData,
  type FlowDefinition,
  type FlowStep,
  type WorkCalendar,
} from '@mono/shared';
import { can, type Actor } from '../work/actor';

/** Small pieces the FMS engine, its AUTO steps and stock-on-steps share (kept apart so no file passes 400 lines). */
export const fmsLink = (r: { id: string }) => `/fms/live?record=${r.id}`;

export function parseDefinition(json: unknown): FlowDefinition {
  return flowDefinitionSchema.parse(json ?? {});
}

/** A step can be finished from a Telegram button only when it asks for nothing but a tap. */
export function telegramActions(step: FlowStep): string[] {
  const simple =
    !step.fields.some((f) => f.required) &&
    !step.checklist.length &&
    !step.proofRequired &&
    !step.documents.length;
  if (!simple) return [];
  if (step.type === 'DECISION') return ['yes', 'no'];
  if (step.type === 'APPROVAL') return ['approve'];
  return ['fmsdone'];
}

export async function log(
  tx: Tx,
  record: Pick<FmsRecord, 'id' | 'companyId'>,
  type: string,
  extra: { stepKey?: string; actorId?: string | null; note?: string | null; data?: object } = {},
) {
  await tx.fmsRecordEvent.create({
    data: { companyId: record.companyId, recordId: record.id, type, ...extra },
  });
}

/** Among the step's doers, the one with the fewest open steps right now (simple load balancing). */
export async function pickDoer(tx: Tx, step: FlowStep, record: FmsRecord): Promise<string | null> {
  if (step.type === 'AUTO') return null;
  if (step.starter && record.startedById) return record.startedById;
  if (!step.doerIds.length) return record.startedById;
  if (step.doerIds.length === 1) return step.doerIds[0]!;
  const loads = await tx.fmsRecordStep.groupBy({
    by: ['doerId'],
    where: { companyId: record.companyId, status: 'OPEN', doerId: { in: step.doerIds } },
    _count: true,
  });
  const load = new Map(loads.map((l) => [l.doerId, l._count]));
  return [...step.doerIds].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0]!;
}

export type Ctx = { flow: Flow; def: FlowDefinition; cal: WorkCalendar; actorId: string | null };

/** The payload every FMS event carries (names for templates come from the ids). */
export function payloadOf(ctx: Ctx, record: FmsRecord, extra: Record<string, unknown> = {}) {
  return {
    flow: ctx.flow.name,
    run: ctx.flow.runName,
    record: `${record.title} (#${record.number})`,
    coordinatorId: ctx.flow.coordinatorId,
    solverId: ctx.flow.solverId,
    link: fmsLink(record),
    ...extra,
  };
}

/** Start form values plus everything entered on finished steps (later steps can use earlier answers). */
export async function recordData(tx: Tx, record: FmsRecord): Promise<Record<string, unknown>> {
  const done = await tx.fmsRecordStep.findMany({
    where: { recordId: record.id, status: 'DONE' },
    orderBy: { doneAt: 'asc' },
  });
  return mergeData(record.data, ...done.map((s) => s.data));
}

/** Who may finish a step: its doer, the flow's problem solver (who steps in when stuck), or an FMS admin. */
export function mayDo(actor: Actor, flow: Flow, doerId: string | null) {
  return (
    doerId === actor.userId ||
    flow.solverId === actor.userId ||
    flow.solverBackupId === actor.userId ||
    can(actor, 'fms.admin')
  );
}
