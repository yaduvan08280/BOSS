import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, MODULES } from '@mono/shared';
import { makeApp, makeCompany } from '../test/helpers';
import { OPEN_TO_EVERYONE, OWN_ACTIONS, PUBLIC } from './open-routes';
import { sampleBody } from './sample';
import {
  addressesFor,
  caller,
  fill,
  fingerprint,
  getList,
  hasParams,
  idsAtBranch,
  idsIn,
  idsOfCompany,
  idsOfRows,
  moveToBranch,
  type Route,
} from './walk';

/**
 * Walks every route the API registers as four people who should get nothing: a visitor, the owner of another
 * company, a member whose role holds no rights, and a person of another branch. Company A is the demo company
 * (people, work, processes, stock, money, hospitality …), so there is real data to leak.
 */
describe('access: every route, as people who should see nothing', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let routes: Route[];
  let companyId: string;
  let aIds: Set<string>;
  let pickA: (kind: string) => string | undefined;
  let owner: Awaited<ReturnType<typeof caller>>;
  /** Ids seen in each list, as the owner — used to give routes with a parameter a real address. */
  const seen = new Map<string, string[]>();
  const SKIP = (r: Route) => r.url.startsWith('/api/events') || r.url.startsWith('/api/docs');

  beforeAll(async () => {
    const root = join(import.meta.dirname, '../../../..');
    execSync('npx tsx prisma/seed-demo.ts', {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, SEED_DEMO_PASSWORD: 'Demo1234', SEED_DEMO_PACKS: '' },
    });
    ctx = await makeApp({ LOGIN_RATE_LIMIT: '100000', API_RATE_LIMIT: '0' });
    routes = ctx.app.routeList.filter((r) => !SKIP(r));
    const company = await ctx.prisma.company.findFirstOrThrow({ where: { name: 'Demo Industries' } });
    companyId = company.id;
    ({ ids: aIds, pick: pickA } = await idsOfCompany(ctx.prisma, companyId));
    owner = await caller(ctx.app, '9000000000', 'Demo1234');
    for (const r of routes.filter((x) => x.method === 'GET' && !hasParams(x))) {
      const res = await getList(owner, r.url);
      if (res.status === 200) seen.set(r.url, idsOfRows(res.body));
    }
  }, 600_000);
  afterAll(async () => ctx?.app.close());

  /** A person of company A made for the walk, with the role given. */
  async function person(name: string, role: { permissions: string[]; reach: string }, branchId?: string) {
    const mobile = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const row = await ctx.prisma.role.create({
      data: { companyId, name: `${name} ${mobile}`, permissions: role.permissions, reach: role.reach },
    });
    const { hashPassword } = await import('../lib/password');
    const user = await ctx.prisma.user.create({
      data: {
        companyId,
        code: `WALK-${mobile.slice(-6)}`,
        name,
        mobile: `+91${mobile}`,
        passwordHash: await hashPassword('Walker123'),
        roleId: row.id,
        loginEnabled: true,
        status: 'ACTIVE',
        ...(branchId ? { branchId } : {}),
      },
    });
    return { id: user.id, roleId: row.id, call: await caller(ctx.app, mobile, 'Walker123') };
  }

  it('walks a real set of routes (the list is not empty by accident)', () => {
    expect(routes.length).toBeGreaterThan(700);
    expect(aIds.size).toBeGreaterThan(1000);
    expect(seen.size).toBeGreaterThan(100);
  });

  it('a visitor gets nothing but the public pages', async () => {
    const visitor = await caller(ctx.app);
    const wrong: string[] = [];
    for (const r of routes) {
      const res = await visitor(r.method, fill(r.url, 'x'));
      const open = PUBLIC.some((p) => p.test(r.url));
      if (open ? res.status >= 500 : res.status !== 401) wrong.push(`${r.method} ${r.url} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 600_000);

  it("another company's owner reads and changes nothing of this company", async () => {
    const other = await makeCompany(ctx.app);
    const call = await caller(ctx.app, other.mobile, other.password);
    const wrong: string[] = [];
    let tried = 0;
    const statuses = new Map<number, number>();
    const leaks = (body: string) => idsIn(body).some((id) => aIds.has(id));
    /** A change answers with nothing of this company beyond the ids the caller sent itself. */
    const tells = (answer: string, sent: string) => {
      const own = new Set(idsIn(sent));
      return idsIn(answer).some((id) => aIds.has(id) && !own.has(id));
    };
    const before = await fingerprint(ctx.prisma, companyId);
    for (const r of routes) {
      if (PUBLIC.some((p) => p.test(r.url))) continue;
      // A body that fits the route, every `…Id` in it an id of the other company.
      const { body, used } = sampleBody(r.body, pickA);
      if (!hasParams(r)) {
        if (r.method === 'GET') {
          const res = await getList(call, r.url);
          if (res.status === 200 && leaks(res.body)) wrong.push(`GET ${r.url} shows this company's rows`);
        } else if (used) {
          const res = await call(r.method, r.url, {}, body);
          statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
          if (res.status < 300 && tells(res.body, JSON.stringify(body)))
            wrong.push(`${r.method} ${r.url} answers with this company's rows`);
        }
        continue;
      }
      for (const { url } of addressesFor(r, seen)) {
        tried += 1;
        const res = r.method === 'GET' ? await getList(call, url) : await call(r.method, url, {}, body);
        if (r.method !== 'GET') statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        if (
          r.method === 'GET'
            ? res.status === 200 && leaks(res.body)
            : res.status < 300 && tells(res.body, url + JSON.stringify(body))
        )
          wrong.push(`${r.method} ${r.url} → ${res.status} shows this company's rows`);
      }
    }
    // The proof for every change tried: not one row of this company is different afterwards.
    const after = await fingerprint(ctx.prisma, companyId);
    for (const [table, mark] of Object.entries(after))
      if (before[table] !== mark) wrong.push(`rows of ${table} changed`);
    console.info('another company, changes tried:', Object.fromEntries(statuses));
    expect(wrong).toEqual([]);
    expect(tried).toBeGreaterThan(300);
  }, 900_000);

  it('a member with no rights reads only what is open to everyone, and changes nothing', async () => {
    const nobody = await person('No Rights', { permissions: [], reach: 'own' });
    const self = new Set([nobody.id, nobody.roleId, companyId]);
    const wrong: string[] = [];
    const counts = { refused: 0, incomplete: 0, missing: 0 };
    const statuses = new Map<number, number>();
    for (const r of routes) {
      if (PUBLIC.some((p) => p.test(r.url))) continue;
      const urls = hasParams(r) ? addressesFor(r, seen, 2).map((a) => a.url) : [r.url];
      for (const url of urls) {
        const res =
          r.method === 'GET'
            ? await getList(nobody.call, url)
            : await nobody.call(r.method, url, {}, sampleBody(r.body, pickA).body);
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        if (res.status === 403) counts.refused += 1;
        else if (res.status === 400) counts.incomplete += 1;
        else if (res.status === 404) counts.missing += 1;
        if (res.status >= 300) continue;
        if (r.method === 'GET') {
          const shows = idsIn(res.body).some((id) => aIds.has(id) && !self.has(id));
          if (shows && !OPEN_TO_EVERYONE.some((p) => p.test(r.url)))
            wrong.push(`GET ${r.url} shows company data to a member with no rights`);
        } else if (!OWN_ACTIONS.some((p) => p.test(`${r.method} ${r.url}`))) {
          wrong.push(`${r.method} ${r.url} → ${res.status} for a member with no rights`);
        }
      }
    }
    console.info('member with no rights:', counts, Object.fromEntries(statuses));
    expect(wrong).toEqual([]);
    expect(counts.refused).toBeGreaterThan(300);
  }, 900_000);

  it('a person of one branch sees nothing that belongs to another branch, whatever the switcher says', async () => {
    const branches = await ctx.prisma.branch.findMany({ where: { companyId, deletedAt: null } });
    const sized = await Promise.all(
      branches.map(async (b) => ({ b, ids: await idsAtBranch(ctx.prisma, companyId, b.id) })),
    );
    sized.sort((x, y) => y.ids.size - x.ids.size);
    const there = sized[0]!;
    const here = sized.at(-1)!;
    // The demo company keeps most work group-wide: move a good part of it to that branch, so there is
    // something of every kind to leak.
    await moveToBranch(ctx.prisma, companyId, there.b.id);
    there.ids = await idsAtBranch(ctx.prisma, companyId, there.b.id);
    expect(there.ids.size).toBeGreaterThan(100);
    const views = MODULES.flatMap((m) => ACTIONS.filter((a) => a === 'view').map((a) => `${m}.${a}`));
    const viewer = await person('Branch Viewer', { permissions: views, reach: 'branches' }, here.b.id);
    const wrong: string[] = [];
    const leaks = (body: string) => idsIn(body).some((id) => there.ids.has(id));
    for (const headers of [{}, { 'x-mono-branch': there.b.id }] as Record<string, string>[])
      for (const r of routes.filter((x) => x.method === 'GET' && !PUBLIC.some((p) => p.test(x.url)))) {
        const urls = hasParams(r)
          ? addressesFor(r, seen, 4)
              .filter((a) => there.ids.has(a.id))
              .map((a) => a.url)
          : [r.url];
        for (const url of urls) {
          const res = await getList(viewer.call, url, headers);
          if (res.status === 200 && leaks(res.body))
            wrong.push(
              `GET ${r.url}${headers['x-mono-branch'] ? ' (switcher)' : ''} shows another branch's rows`,
            );
        }
      }
    expect(wrong).toEqual([]);
  }, 900_000);
});
