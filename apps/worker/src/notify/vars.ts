import type { Db } from '@mono/db';
import { formatDateTime } from '@mono/shared';

const DATE_KEYS = new Set(['due', 'from', 'to', 'date', 'time', 'last', 'at']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Variables for templates: every scalar in the payload, user ids turned into names (doerId → doer),
 * ISO dates shown as DD/MM/YYYY HH:mm in the company time zone, plus app, company, actor and link.
 */
export async function buildVars(
  db: Db,
  ctx: { companyId: string; companyName: string; timezone: string; appName: string; baseUrl: string },
  payload: Record<string, unknown>,
  actorId: string | null,
) {
  const vars: Record<string, string> = { app: ctx.appName, company: ctx.companyName };
  const userIds = new Map<string, string>();
  for (const [k, v] of Object.entries(payload)) {
    if (k.endsWith('Id') && typeof v === 'string') userIds.set(k.slice(0, -2), v);
  }
  if (actorId) userIds.set('actor', actorId);
  const names = userIds.size
    ? await db.user.findMany({
        where: { companyId: ctx.companyId, id: { in: [...userIds.values()] } },
        select: { id: true, name: true },
      })
    : [];
  const byId = new Map(names.map((n) => [n.id, n.name]));
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined || typeof v === 'object') continue;
    const s = String(v);
    vars[k] = (DATE_KEYS.has(k) || ISO.test(s)) && ISO.test(s) ? formatDateTime(s, ctx.timezone) : s;
  }
  for (const [k, id] of userIds)
    if (byId.has(id) && !(k in payload && typeof payload[k] === 'string')) vars[k] = byId.get(id)!;
  if (!vars.actor) vars.actor = ctx.appName;
  const link = typeof payload.link === 'string' ? payload.link : null;
  vars.link = link ? (link.startsWith('http') ? link : `${ctx.baseUrl}${link}`) : ctx.baseUrl;
  return vars;
}
