import type { Db, Tx } from '@mono/db';
import { AppError, notFound } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { emitEvent } from '../../lib/events';
import { can, type Actor } from '../work/actor';
import { checkPerson, log } from './service';

export async function editTask(
  db: Db,
  actor: Actor,
  taskId: string,
  input: { description?: string; verifierId?: string | null; requireProof?: boolean },
) {
  return db.$transaction(async (tx) => {
    const t = await tx.task.findFirst({ where: { id: taskId, companyId: actor.companyId, deletedAt: null } });
    if (!t) throw notFound('Task');
    if (t.creatorId !== actor.userId && !can(actor, 'delegation.admin'))
      throw new AppError(403, 'FORBIDDEN', 'Only the person who gave the task can edit it');
    if (['DONE', 'CANCELLED'].includes(t.status))
      throw new AppError(409, 'CONFLICT', 'Finished tasks are not edited; reopen it first');
    if (input.verifierId) await checkPerson(tx, actor.companyId, input.verifierId, 'The verifier');
    const updated = await tx.task.update({ where: { id: t.id }, data: input });
    await log(tx, t, actor.userId, 'edited', {
      note: input.description && input.description !== t.description ? 'Description changed' : null,
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'task.edited', entityType: 'task', entityId: t.id, before: t, after: updated },
    );
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      { name: 'task.edited', entityType: 'task', entityId: t.id },
    );
    return updated;
  });
}

/** For Telegram "/done 70": find the task by its number. */
export async function taskByNumber(db: Db | Tx, companyId: string, number: number) {
  return db.task.findFirst({ where: { companyId, number, deletedAt: null } });
}
