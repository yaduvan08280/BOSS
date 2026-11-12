import type { Db } from '@mono/db';
import { strToU8, zipSync } from 'fflate';
import { AppError, notFound } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import type { Storage } from '../../lib/storage';
import type { Actor } from '../work/actor';
import { needBrandTeam } from './guard';

/**
 * A franchise leaves (phase 12, plan §3.8): first everything that is theirs — data and files — is handed over as
 * one package; then the entity is archived. Nothing is deleted: history stays, the franchise's people can no
 * longer sign in, and its branches leave every picker.
 */
const needAdmin = (a: Actor) => needBrandTeam(a, 'handles a franchise exit');
/** Files are included up to this much in all; the rest are listed in the manifest as left out. */
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const json = (rows: unknown) =>
  strToU8(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : (v as unknown)), 2));
async function read(storage: Storage, key: string): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of storage.get(key)) chunks.push(Buffer.from(c as Buffer));
  return new Uint8Array(Buffer.concat(chunks));
}

async function franchiseOf(db: Db, actor: Actor, entityId: string) {
  const entity = await db.legalEntity.findFirst({ where: { id: entityId, companyId: actor.companyId } });
  if (!entity || entity.kind !== 'FRANCHISE') throw notFound('Franchise');
  const branches = await db.branch.findMany({ where: { companyId: actor.companyId, entityId } });
  return { entity, branches, branchIds: branches.map((b) => b.id) };
}

/** Everything of one franchise as a zip: a JSON file per kind of data, the files, and a manifest. */
export async function exportFranchise(db: Db, storage: Storage, actor: Actor, entityId: string) {
  needAdmin(actor);
  const { entity, branches, branchIds } = await franchiseOf(db, actor, entityId);
  const at = { companyId: actor.companyId, branchId: { in: branchIds } };
  const people = await db.user.findMany({
    where: { companyId: actor.companyId, branchId: { in: branchIds } },
    // Never a password hash or a chat id: this leaves the building.
    select: {
      id: true,
      code: true,
      name: true,
      mobile: true,
      email: true,
      status: true,
      branchId: true,
      hr: true,
    },
  });
  const ids = people.map((p) => p.id);
  const records = await db.fmsRecord.findMany({ where: at });
  const data: Record<string, unknown[]> = {
    branches,
    people,
    tasks: await db.task.findMany({ where: at }),
    checklistRuns: await db.checklistRun.findMany({ where: at, include: { items: true } }),
    slips: await db.slip.findMany({ where: at }),
    tickets: await db.ticket.findMany({ where: at }),
    processRecords: records,
    processSteps: await db.fmsRecordStep.findMany({ where: { recordId: { in: records.map((r) => r.id) } } }),
    documents: await db.document.findMany({ where: at }),
    purchaseOrders: await db.purchaseOrder.findMany({ where: at }),
    salesOrders: await db.salesOrder.findMany({ where: at }),
    records: await db.recordEntry.findMany({ where: at }),
    masterRows: await db.masterRow.findMany({ where: at }),
    attendance: await db.attendanceDay.findMany({
      where: { companyId: actor.companyId, userId: { in: ids } },
    }),
    leave: await db.leaveRequest.findMany({ where: { companyId: actor.companyId, userId: { in: ids } } }),
    royaltyInvoices: await db.royaltyInvoice.findMany({ where: { companyId: actor.companyId, entityId } }),
    brandAudits: await db.brandAudit.findMany({ where: at }),
  };
  const files = await db.attachment.findMany({
    where: { companyId: actor.companyId, deletedAt: null, uploadedById: { in: ids } },
    orderBy: { createdAt: 'asc' },
  });
  const zip: Record<string, Uint8Array> = {};
  for (const [name, rows] of Object.entries(data)) zip[`data/${name}.json`] = json(rows);
  let bytes = 0;
  const manifest = [];
  for (const f of files) {
    let included = false;
    if (bytes + f.size <= MAX_FILE_BYTES) {
      try {
        zip[`files/${f.id}-${f.originalName.replace(/[^\w.-]+/g, '_')}`] = await read(storage, f.path);
        bytes += f.size;
        included = true;
      } catch {
        // A file that is no longer on disk is named in the manifest, not silently dropped.
      }
    }
    manifest.push({
      id: f.id,
      name: f.originalName,
      mime: f.mime,
      size: f.size,
      of: `${f.entityType}:${f.entityId}`,
      included,
    });
  }
  zip['manifest.json'] = json({
    entity: { id: entity.id, name: entity.name, taxId: entity.taxId, currency: entity.currency },
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    files: manifest,
  });
  await writeAudit(
    db,
    { companyId: actor.companyId, actorId: actor.userId },
    {
      action: 'franchise.exported',
      entityType: 'legal_entity',
      entityId,
      after: { files: manifest.length, included: manifest.filter((m) => m.included).length },
    },
  );
  return { name: `${entity.name.replace(/[^\w-]+/g, '_')}-export.zip`, zip: Buffer.from(zipSync(zip)) };
}

/** Archive a franchise after its export: its people are signed out for good, its branches and entity retire. */
export async function archiveFranchise(db: Db, actor: Actor, entityId: string) {
  needAdmin(actor);
  const { entity, branchIds } = await franchiseOf(db, actor, entityId);
  if (entity.deletedAt) throw new AppError(409, 'CONFLICT', 'This franchise is already archived');
  const exported = await db.auditLog.count({
    where: { companyId: actor.companyId, action: 'franchise.exported', entityId },
  });
  if (!exported)
    throw new AppError(409, 'CONFLICT', 'Export this franchise first: the package is theirs to keep');
  const now = new Date();
  return db.$transaction(async (tx) => {
    const people = await tx.user.findMany({
      where: { companyId: actor.companyId, branchId: { in: branchIds }, deletedAt: null },
      select: { id: true },
    });
    const ids = people.map((p) => p.id);
    await tx.user.updateMany({
      where: { id: { in: ids } },
      data: { loginEnabled: false, status: 'INACTIVE' },
    });
    await tx.session.updateMany({
      where: { userId: { in: ids }, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.branchManager.deleteMany({ where: { companyId: actor.companyId, branchId: { in: branchIds } } });
    await tx.branch.updateMany({
      where: { id: { in: branchIds }, deletedAt: null },
      data: { closedAt: now, deletedAt: now },
    });
    await tx.legalEntity.update({ where: { id: entityId }, data: { deletedAt: now } });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'franchise.archived',
        entityType: 'legal_entity',
        entityId,
        after: { people: ids.length, branches: branchIds.length },
      },
    );
    return { ok: true, people: ids.length, branches: branchIds.length };
  });
}
