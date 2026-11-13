import type { Db } from '@mono/db';
import { mergeWords, PACK_LIBRARY, type PackMade } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { needPackAdmin } from './install';

/** The packs on offer and the ones installed here. */
export async function listPacks(db: Db, actor: Actor) {
  const rows = await db.packInstall.findMany({
    where: { companyId: actor.companyId, removedAt: null },
    orderBy: { installedAt: 'asc' },
  });
  const library = PACK_LIBRARY.map((p) => {
    const mine = rows.find((r) => r.key === p.key);
    return {
      key: p.key,
      name: p.name,
      industry: p.industry,
      description: p.description ?? '',
      version: p.version,
      installed: mine?.version ?? null,
      upgrade: Boolean(mine && mine.version < p.version),
    };
  });
  return {
    library,
    installed: rows.map((r) => ({
      key: r.key,
      name: r.name,
      industry: r.industry,
      version: r.version,
      installedAt: r.installedAt,
      things: (r.made as unknown as PackMade[]).filter((m) => m.kind !== 'list').length,
      shipped: PACK_LIBRARY.some((p) => p.key === r.key),
    })),
  };
}

/**
 * Take a pack off. Everything it made stays — masters and their rows, record types and their records, processes,
 * items, roles: only the pack's words and its line in the list go.
 */
export async function removePack(db: Db, actor: Actor, key: string) {
  needPackAdmin(actor);
  const row = await db.packInstall.findUnique({
    where: { companyId_key: { companyId: actor.companyId, key } },
  });
  if (!row || row.removedAt) throw notFound('Pack');
  await db.$transaction(async (tx) => {
    await tx.packInstall.update({ where: { id: row.id }, data: { removedAt: new Date() } });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'pack.removed',
        entityType: 'pack',
        entityId: row.id,
        before: { key, version: row.version },
      },
    );
  });
  return { ok: true, kept: (row.made as unknown as PackMade[]).length };
}

/** The words of the company's packs, for every screen (a later pack wins over an earlier one). */
export async function packWords(db: Db, companyId: string) {
  const rows = await db.packInstall.findMany({
    where: { companyId, removedAt: null },
    orderBy: { installedAt: 'asc' },
    select: { words: true },
  });
  return mergeWords(rows);
}
