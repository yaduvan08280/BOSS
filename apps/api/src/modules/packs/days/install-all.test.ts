import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PACK_LIBRARY } from '@mono/shared';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, type Installed } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('The packs MONO ships (phase 21)', { timeout: 180_000 }, () => {
  it('every pack of the library installs into an empty company, and again changes nothing', async () => {
    for (const pack of PACK_LIBRARY) {
      const w = await world(ctx.app);
      const first = await w.api.post(`/api/packs/library/${pack.key}`);
      expect(first.status, `${pack.key}: ${JSON.stringify(first.body)}`).toBe(200);
      expect((first.body as Installed).made.length, pack.key).toBeGreaterThan(3);
      expect((await ok<Installed>(w.api.post(`/api/packs/library/${pack.key}`))).made, pack.key).toEqual([]);
      await quiet(ctx.prisma, w.companyId);
    }
  });

  it('all ten packs live in one company side by side', async () => {
    const w = await world(ctx.app);
    for (const pack of PACK_LIBRARY) {
      const r = await w.api.post(`/api/packs/library/${pack.key}`);
      expect(r.status, `${pack.key}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    const list = await ok<{ installed: { key: string }[] }>(w.api.get('/api/packs'));
    expect(list.installed).toHaveLength(PACK_LIBRARY.length);
    // What two trades both name (a tax code, a role's name) is shared, never made twice.
    expect(await ctx.prisma.taxRate.count({ where: { companyId: w.companyId, code: 'GST18' } })).toBe(1);
    await quiet(ctx.prisma, w.companyId);
  });
});
