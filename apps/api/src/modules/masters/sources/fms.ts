import { Prisma } from '@mono/db';
import type { SourceHandler } from './index';

/**
 * `fms:<flowId>:<field>` — the distinct values typed in that field (the start form or any finished step) across
 * that flow's live records: "Vendor name" entered in Purchase request becomes the dropdown in Goods receipt.
 * Cancelled and deleted records are left out. Spellings that differ only by case or outer spaces are one choice
 * (the spelling used most is shown); the most used values come first. A value is text, not a row, so it carries
 * no link.
 */
export const fmsValueSource: SourceHandler = async (db, actor, arg, query) => {
  const [flowId, field] = arg.split(':');
  if (!flowId || !field || query.ids) return [];
  const companyId = actor.companyId;
  const flow = await db.flow.findFirst({
    where: { id: flowId, companyId, deletedAt: null },
    select: { id: true },
  });
  if (!flow) return [];
  const q = query.q.trim();
  const search = q ? Prisma.sql`AND v ILIKE ${`%${q.replace(/[\\%_]/g, '\\$&')}%`}` : Prisma.empty;
  const rows = await db.$queryRaw<{ value: string; uses: bigint }[]>(Prisma.sql`
    WITH typed AS (
      SELECT btrim(r.data ->> ${field}) AS v
        FROM fms_records r
       WHERE r.company_id = ${companyId} AND r.flow_id = ${flowId}
         AND r.deleted_at IS NULL AND r.status <> 'CANCELLED'
         AND jsonb_typeof(r.data -> ${field}) IN ('string', 'number')
      UNION ALL
      SELECT btrim(s.data ->> ${field})
        FROM fms_record_steps s
        JOIN fms_records r ON r.id = s.record_id
       WHERE s.company_id = ${companyId} AND s.status = 'DONE'
         AND r.company_id = ${companyId} AND r.flow_id = ${flowId}
         AND r.deleted_at IS NULL AND r.status <> 'CANCELLED'
         AND jsonb_typeof(s.data -> ${field}) IN ('string', 'number')
    )
    SELECT mode() WITHIN GROUP (ORDER BY v) AS value, count(*) AS uses
      FROM typed
     WHERE v <> '' ${search}
     GROUP BY lower(v)
     ORDER BY uses DESC, value ASC
     LIMIT ${query.limit}`);
  return rows.map((r) => ({ value: r.value, label: r.value, sub: null }));
};
