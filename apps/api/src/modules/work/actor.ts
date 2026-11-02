import type { Db, Tx } from '@mono/db';
import { hasPermission } from '@mono/shared';

/** Who is acting: from a web request or from the Telegram bot. */
export type Actor = {
  companyId: string;
  userId: string;
  permissions: string[];
  ip?: string | null;
  userAgent?: string | null;
};

export async function actorFor(db: Db | Tx, companyId: string, userId: string): Promise<Actor | null> {
  const u = await db.user.findFirst({
    where: { id: userId, companyId, deletedAt: null, status: 'ACTIVE' },
    select: { role: { select: { permissions: true } } },
  });
  return u ? { companyId, userId, permissions: u.role.permissions } : null;
}

export const can = (a: Actor, key: Parameters<typeof hasPermission>[1]) => hasPermission(a.permissions, key);

/** People whose work an HOD can see: members of the departments (and sub-departments) they head. */
export async function teamOf(db: Db | Tx, companyId: string, userId: string): Promise<string[]> {
  const depts = await db.department.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, parentId: true, hodUserId: true },
  });
  const mine = new Set(depts.filter((d) => d.hodUserId === userId).map((d) => d.id));
  let grew = mine.size > 0;
  while (grew) {
    grew = false;
    for (const d of depts) {
      if (d.parentId && mine.has(d.parentId) && !mine.has(d.id)) {
        mine.add(d.id);
        grew = true;
      }
    }
  }
  if (!mine.size) return [];
  const ids = [...mine];
  const people = await db.user.findMany({
    where: {
      companyId,
      deletedAt: null,
      OR: [{ mainDepartmentId: { in: ids } }, { departments: { some: { departmentId: { in: ids } } } }],
    },
    select: { id: true },
  });
  return people.map((p) => p.id);
}

/** Link uploaded files (still marked "upload" by the uploader) to a record. */
export async function attachUploads(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: string[],
  entityType: string,
  entityId: string,
) {
  if (!ids.length) return 0;
  const res = await tx.attachment.updateMany({
    where: { id: { in: ids }, companyId, uploadedById: userId, entityType: 'upload', deletedAt: null },
    data: { entityType, entityId },
  });
  return res.count;
}
