import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from './client';
import { formatNumber, nextCounter } from './counters';
import { COMPANY_SCOPED_MODELS, forCompany, SOFT_DELETE_MODELS } from './scope';

const schemaDir = join(import.meta.dirname, '../../../prisma/schema');

function modelsWith(field: string): string[] {
  const src = readdirSync(schemaDir)
    .filter((f) => f.endsWith('.prisma'))
    .map((f) => readFileSync(join(schemaDir, f), 'utf8'))
    .join('\n');
  const out: string[] = [];
  for (const m of src.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
    if (new RegExp(`^\\s+${field}\\s`, 'm').test(m[2] ?? '')) out.push(m[1]!);
  }
  return out.sort();
}

describe('scope lists match the schema', () => {
  it('lists every model with companyId', () => {
    expect([...COMPANY_SCOPED_MODELS].sort()).toEqual(modelsWith('companyId'));
  });
  it('lists every model with deletedAt', () => {
    expect([...SOFT_DELETE_MODELS].sort()).toEqual(modelsWith('deletedAt'));
  });
});

describe('forCompany()', () => {
  const db = createPrisma();
  let a = '';
  let b = '';

  beforeAll(async () => {
    const tag = Date.now().toString(36);
    a = (await db.company.create({ data: { name: 'A', slug: `a-${tag}` } })).id;
    b = (await db.company.create({ data: { name: 'B', slug: `b-${tag}` } })).id;
    for (const companyId of [a, b]) {
      const role = await db.role.create({ data: { companyId, name: 'Member', key: 'MEMBER' } });
      await db.user.create({
        data: { companyId, code: 'EMP-001', name: `Person ${companyId}`, roleId: role.id },
      });
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('only sees its own rows', async () => {
    const scoped = forCompany(db, a);
    const users = await scoped.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]!.companyId).toBe(a);
    const other = await db.user.findFirstOrThrow({ where: { companyId: b } });
    expect(await scoped.user.findUnique({ where: { id: other.id } })).toBeNull();
    const updated = await scoped.user.updateMany({ where: { id: other.id }, data: { name: 'hacked' } });
    expect(updated.count).toBe(0);
  });

  it('forces companyId on create', async () => {
    const scoped = forCompany(db, a);
    const d = await scoped.designation.create({ data: { name: 'Fitter', companyId: b } });
    expect(d.companyId).toBe(a);
  });

  it('hides soft-deleted rows from lists', async () => {
    const scoped = forCompany(db, a);
    const d = await scoped.designation.create({ data: { name: 'Old', companyId: a } });
    await scoped.designation.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    const names = (await scoped.designation.findMany()).map((x) => x.name);
    expect(names).not.toContain('Old');
    const withDeleted = await scoped.designation.findMany({ where: { deletedAt: { not: null } } });
    expect(withDeleted.map((x) => x.name)).toContain('Old');
  });

  it('hands out counters without gaps under concurrency', async () => {
    const values = await Promise.all(
      Array.from({ length: 10 }, () => db.$transaction((tx) => nextCounter(tx, a, 'test', '26-27'))),
    );
    expect(values.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(formatNumber('BOP', 4, { fy: '26-27', pad: 4 })).toBe('BOP/26-27/0004');
    expect(formatNumber('EMP', 1)).toBe('EMP-001');
  });
});
