import type { Prisma, Tx } from '@mono/db';

export type ActorContext = {
  companyId: string;
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/** Write one audit_log row. Call inside the same transaction as the change. */
export async function writeAudit(
  tx: Tx,
  ctx: ActorContext,
  entry: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId: ctx.companyId,
      actorId: ctx.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    },
  });
}
