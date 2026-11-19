import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@mono/db';
import { BRANCH_SCOPED_MODELS } from '@mono/db';
import type { makeApp } from '../test/helpers';
import { asHeader, cookieHeader, ORIGIN } from '../test/helpers';

type App = Awaited<ReturnType<typeof makeApp>>['app'];
export type Route = { method: string; url: string; body?: unknown };
export type Answer = { status: number; body: string };

/** Ids as MONO makes them (cuid2: 24 lower-case letters and digits). */
const ID = /\b[a-z][a-z0-9]{23}\b/g;
export const idsIn = (text: string) => text.match(ID) ?? [];

/** A caller: a signed-in person, or nobody (`jar` empty). Never follows `/api/events` (it never ends). */
export async function caller(app: App, identifier?: string, password?: string) {
  let jar: Record<string, string> = {};
  if (identifier) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { identifier, password },
    });
    if (res.statusCode !== 200) throw new Error(`sign-in failed for ${identifier}: ${res.body}`);
    jar = cookieHeader(res);
  }
  return async (
    method: string,
    url: string,
    headers: Record<string, string> = {},
    payload: object = {},
  ): Promise<Answer> => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: { ...(identifier ? { cookie: asHeader(jar) } : {}), origin: ORIGIN, ...headers },
      ...(method === 'GET' ? {} : { payload }),
    });
    return { status: res.statusCode, body: res.body };
  };
}

export const hasParams = (r: Route) => r.url.includes(':') || r.url.includes('*');
export const fill = (url: string, value: string) =>
  url.replace(/:[A-Za-z]+\??/g, value).replace(/\*/g, value);

/** Every id of every row that belongs to a company (all tables with a `company_id`). */
export async function idsOfCompany(db: Db, companyId: string) {
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `select c.table_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'company_id'
       and exists (select 1 from information_schema.columns i
                   where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')`,
  );
  const ids = new Set<string>([companyId]);
  const byTable = new Map<string, string[]>();
  for (const { table_name } of tables) {
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(
      `select id::text as id from "${table_name}" where company_id = $1`,
      companyId,
    );
    const good = rows.map((r) => r.id).filter((id) => /^[a-z][a-z0-9]{23}$/.test(id));
    for (const id of good) ids.add(id);
    if (good.length) byTable.set(table_name, good);
  }
  /** An id of the kind a field names (`customer` → a row of `customers`), if the company has one. */
  const pick = (kind: string) => {
    const snake = kind.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, '');
    for (const table of [`${snake}s`, `${snake}es`, `${snake.replace(/y$/, 'ies')}`, snake])
      if (byTable.has(table)) return byTable.get(table)![0];
    return undefined;
  };
  return { ids, pick };
}

/** A fingerprint of everything a company holds: the same before and after means nothing of it was changed. */
export async function fingerprint(db: Db, companyId: string) {
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'company_id' order by table_name`,
  );
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    const [row] = await db.$queryRawUnsafe<{ n: bigint; h: string | null }[]>(
      `select count(*) as n, md5(string_agg(md5(t::text), '' order by md5(t::text))) as h
       from "${table_name}" t where company_id = $1`,
      companyId,
    );
    out[table_name] = `${row!.n}:${row!.h ?? ''}`;
  }
  return out;
}

/** Table names of the models whose rows belong to a branch (read from the schema files). */
function scopedTables() {
  const dir = join(import.meta.dirname, '../../../../prisma/schema');
  const out: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.prisma'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm))
      if (BRANCH_SCOPED_MODELS[m[1]!]) {
        const table = /@@map\("([^"]+)"\)/.exec(m[2]!)?.[1];
        if (table) out.push(table);
      }
  }
  return out;
}

/** Ids of the rows that sit at one branch, by table. */
export async function idsAtBranch(db: Db, companyId: string, branchId: string) {
  const ids = new Set<string>();
  for (const table of scopedTables()) {
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(
      `select id::text as id from "${table}" where company_id = $1 and branch_id = $2`,
      companyId,
      branchId,
    );
    for (const r of rows) ids.add(r.id);
  }
  return ids;
}

/** Puts up to 40 group-wide rows of each branch-bound kind at one branch (test set-up only). */
export async function moveToBranch(db: Db, companyId: string, branchId: string) {
  for (const table of scopedTables())
    await db.$executeRawUnsafe(
      `update "${table}" set branch_id = $2 where id in
         (select id from "${table}" where company_id = $1 and branch_id is null order by id limit 40)`,
      companyId,
      branchId,
    );
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
/** What a list usually asks for, tried when a bare address is refused as incomplete. */
export const usualQuery = () =>
  `from=${day(-30)}&to=${day(1)}&date=${day(0)}&day=${day(0)}&month=${day(0).slice(0, 7)}&week=${day(0)}&at=${day(0)}`;

/** GET a list; if it is refused for missing dates, once more with the usual ones. */
export async function getList(call: Awaited<ReturnType<typeof caller>>, url: string, headers = {}) {
  const first = await call('GET', url, headers);
  if (first.status !== 400) return first;
  return call('GET', `${url}?${usualQuery()}`, headers);
}

/** The first ids (the `id` of objects, at any depth) a JSON answer holds. */
export function idsOfRows(body: string, max = 4) {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (out.length >= max || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Record<string, unknown>;
    if (typeof o.id === 'string' && /^[a-z][a-z0-9]{23}$/.test(o.id) && !out.includes(o.id)) out.push(o.id);
    Object.values(o).forEach(walk);
  };
  try {
    walk(JSON.parse(body));
  } catch {
    /* not JSON (a file, a page) */
  }
  return out;
}

/**
 * Real addresses for routes with a parameter: each `:id` is filled with ids taken from the lists whose address
 * the route starts with (`/api/x/things/:id/notes` ← ids seen in `/api/x/things` and `/api/x`).
 */
export function addressesFor(route: Route, seen: Map<string, string[]>, perRoute = 3) {
  const head = route.url.slice(0, route.url.search(/[:*]/)).replace(/\/$/, '');
  const from = [...seen.keys()]
    .filter((list) => head === list || head.startsWith(`${list}/`) || list.startsWith(`${head}/`))
    .sort((a, b) => b.length - a.length);
  const ids = [...new Set(from.flatMap((list) => seen.get(list)!))].slice(0, perRoute);
  return ids.map((id) => ({ id, url: fill(route.url, id) }));
}
