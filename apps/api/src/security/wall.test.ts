import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acrossCompanies, OtherCompanyError, runWithReachSlot, setCompany } from '@mono/db';
import { makeApp, makeCompany } from '../test/helpers';

/** The company wall in the database client (decision 250): what a signed-in request can and cannot touch. */
describe('the company wall', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    ctx = await makeApp();
  });
  afterAll(async () => ctx.app.close());

  /** Runs `fn` as a request of that company would: in its own slot, with the company set. */
  const asCompany = <T>(companyId: string, fn: () => Promise<T>) =>
    runWithReachSlot(async () => {
      setCompany(companyId);
      return await fn();
    });

  it("refuses to read, change, delete or create another company's rows — whatever the query says", async () => {
    const a = await makeCompany(ctx.app);
    const b = await makeCompany(ctx.app);
    const db = ctx.prisma;
    const theirs = await db.department.create({ data: { companyId: a.company.id, name: 'Their Stores' } });

    await asCompany(b.company.id, async () => {
      // By key, by filter, and with the other company named outright: nothing comes back.
      expect(await db.department.findUnique({ where: { id: theirs.id } })).toBeNull();
      expect(await db.department.findFirst({ where: { id: theirs.id } })).toBeNull();
      expect(await db.department.findMany({ where: { companyId: a.company.id } })).toEqual([]);
      expect(await db.department.count({ where: { name: 'Their Stores' } })).toBe(0);
      // A change or a delete by id is "not found"; a change by filter touches nothing.
      await expect(
        db.department.update({ where: { id: theirs.id }, data: { name: 'Taken' } }),
      ).rejects.toMatchObject({ code: 'P2025' });
      await expect(db.department.delete({ where: { id: theirs.id } })).rejects.toMatchObject({
        code: 'P2025',
      });
      expect(
        (await db.department.updateMany({ where: { id: theirs.id }, data: { name: 'Taken' } })).count,
      ).toBe(0);
      expect((await db.department.deleteMany({ where: { id: theirs.id } })).count).toBe(0);
      // Nor can a row be made in the other company's name.
      await expect(
        db.department.create({ data: { companyId: a.company.id, name: 'Planted' } }),
      ).rejects.toBeInstanceOf(OtherCompanyError);
      // The same inside a transaction.
      await db.$transaction(async (tx) => {
        expect(await tx.department.findUnique({ where: { id: theirs.id } })).toBeNull();
      });
      // Its own rows are untouched by the wall.
      const own = await db.department.create({ data: { companyId: b.company.id, name: 'Own Stores' } });
      expect((await db.department.findUnique({ where: { id: own.id } }))?.name).toBe('Own Stores');
      // Reading another company on purpose says so.
      expect(
        await acrossCompanies(async () => await db.department.findUnique({ where: { id: theirs.id } })),
      ).not.toBeNull();
    });

    // The row is exactly as it was; outside a request (the worker, a seed) nothing is added.
    expect((await db.department.findUnique({ where: { id: theirs.id } }))?.name).toBe('Their Stores');
  });

  it('an API answer for a row of another company is 404, not an error page', async () => {
    const a = await makeCompany(ctx.app);
    const b = await makeCompany(ctx.app);
    const { signedIn } = await import('../test/helpers');
    const theirs = await ctx.prisma.department.create({
      data: { companyId: a.company.id, name: 'Their Lab' },
    });
    const api = await signedIn(ctx.app, b.mobile, b.password);
    const res = await api.patch(`/api/org/departments/${theirs.id}`, { name: 'Ours now' });
    expect(res.status).toBe(404);
    expect((await ctx.prisma.department.findUnique({ where: { id: theirs.id } }))?.name).toBe('Their Lab');
  });
});
