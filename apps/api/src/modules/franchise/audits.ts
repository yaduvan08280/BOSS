import type { Db } from '@mono/db';
import { localDate } from '@mono/shared';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { writeAudit } from '../../lib/audit';
import { createTask } from '../delegation/service';
import { placeHolders } from '../branches/approvals';
import type { Actor } from '../work/actor';
import { needBrandTeam } from './guard';

/**
 * Brand audits (phase 12, plan §3.8): a head-office auditor goes through the brand's points at an outlet, marks
 * each passed or failed with a note and a photo, and gets a score. Every failed point becomes a task for the
 * outlet's manager, due in the days the auditor gives — so an audit ends in work, not in a report.
 */
export const auditInputSchema = z.object({
  branchId: z.string().max(40),
  title: z.string().trim().min(2).max(120),
  items: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(300),
        ok: z.boolean(),
        note: z.string().trim().max(500).nullish(),
        photoId: z.string().max(40).nullish(),
      }),
    )
    .min(1, 'Add at least one point')
    .max(100),
  /** Days the outlet has to correct each failed point. */
  correctWithinDays: z.number().int().min(1).max(90).default(7),
});
export type AuditInput = z.infer<typeof auditInputSchema>;

export async function recordAudit(db: Db, actor: Actor, input: AuditInput) {
  needBrandTeam(actor, 'records brand audits');
  const branch = await db.branch.findFirst({
    where: { id: input.branchId, companyId: actor.companyId, deletedAt: null },
  });
  if (!branch) throw notFound('Branch');
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  const passed = input.items.filter((i) => i.ok).length;
  const score = Math.round((passed / input.items.length) * 100);
  const failed = input.items.filter((i) => !i.ok);
  // Who corrects: the outlet's manager; with none, the auditor keeps the tasks so nothing is lost.
  const managers = await placeHolders(db, actor.companyId, 'branch_manager', null, branch.id);
  const doerId = managers[0] ?? actor.userId;
  const due = new Date(Date.now() + input.correctWithinDays * 86_400_000);
  return db.$transaction(async (tx) => {
    const items: (AuditInput['items'][number] & { taskId?: string })[] = [];
    for (const it of input.items) {
      if (it.ok) {
        items.push(it);
        continue;
      }
      const task = await createTask(tx, actor, {
        doerId,
        plannedAt: due.toISOString(),
        description: `Brand audit "${input.title}" at ${branch.name}: ${it.text}${it.note ? ` — ${it.note}` : ''}`,
        requireProof: true,
        source: 'brand_audit',
      });
      // The task belongs to the audited outlet, whoever does it.
      await tx.task.update({ where: { id: task.id }, data: { branchId: branch.id } });
      items.push({ ...it, taskId: task.id });
    }
    const row = await tx.brandAudit.create({
      data: {
        companyId: actor.companyId,
        branchId: branch.id,
        auditorId: actor.userId,
        title: input.title,
        date: localDate(new Date(), company.timezone),
        items: items as object[],
        score,
      },
    });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      { action: 'franchise.audit_recorded', entityType: 'brand_audit', entityId: row.id, after: { score } },
    );
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        name: 'franchise.audit_done',
        entityType: 'brand_audit',
        entityId: row.id,
        payload: { branchId: branch.id, place: branch.name, score, failed: failed.length, link: '/outlets' },
      },
    );
    return { id: row.id, score, tasks: items.flatMap((i) => (i.taskId ? [i.taskId] : [])) };
  });
}

/** Audits the reader may see (the fence keeps a franchise to its own, and hides franchises without oversight). */
export async function listAudits(db: Db, actor: Actor, branchId?: string) {
  const rows = await db.brandAudit.findMany({
    where: { companyId: actor.companyId, ...(branchId ? { branchId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    branchId: r.branchId,
    auditorId: r.auditorId,
    title: r.title,
    date: r.date,
    score: r.score,
    items: r.items,
  }));
}
