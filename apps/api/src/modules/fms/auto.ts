import type { FmsRecord, Tx } from '@mono/db';
import type { FlowDefinition, FlowStep } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { fmsStockMoves } from '../ims/fms';
import { createDocument } from './documents';
import { log, payloadOf, type Ctx } from './engine-helpers';

/** AUTO steps (CLAUDE.md §6.1): the system sends a message, makes a document, or moves stock. */
export function customerContact(def: FlowDefinition, data: Record<string, unknown>) {
  const mobile = def.startFields.find((f) => f.type === 'mobile');
  const email = def.startFields.find((f) => f.type === 'email');
  return {
    customerMobile: mobile ? (data[mobile.key] as string | undefined) : undefined,
    customerEmail: email ? (data[email.key] as string | undefined) : undefined,
  };
}

export async function runAuto(
  tx: Tx,
  ctx: Ctx,
  record: FmsRecord,
  step: FlowStep,
  data: Record<string, unknown>,
  /** The record's step row: stock moves keep it, so they can be reversed with their step. */
  stepId: string | null = null,
) {
  const a = step.auto;
  if (a?.action === 'document' && a.documentType) {
    const doc = await createDocument(tx, {
      companyId: record.companyId,
      typeCode: a.documentType,
      recordId: record.id,
      stepKey: step.key,
      data,
      party: record.title,
    });
    await log(tx, record, 'document', { stepKey: step.key, note: doc.number });
  } else if (a?.action === 'message') {
    await emitEvent(
      tx,
      { companyId: record.companyId, actorId: null },
      {
        name: 'fms.customer_update',
        entityType: 'fms_record',
        entityId: record.id,
        payload: payloadOf(ctx, record, {
          ...customerContact(ctx.def, data),
          customer: record.title,
          text: a.text ?? step.name,
        }),
      },
    );
    await log(tx, record, 'auto', { stepKey: step.key, note: 'Message sent' });
  } else if (a?.action === 'stock') {
    const note = await fmsStockMoves(tx, record, step, ctx.def, data, stepId);
    await log(tx, record, 'auto', { stepKey: step.key, note });
  } else {
    await log(tx, record, 'auto', { stepKey: step.key, note: 'Done' });
  }
}
