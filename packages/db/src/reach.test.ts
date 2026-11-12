import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRANCH_FREE_MODELS, BRANCH_SCOPED_MODELS, reachWhere } from './reach';

const schemaDir = join(import.meta.dirname, '../../../prisma/schema');
function modelsWith(field: string): string[] {
  const src = readdirSync(schemaDir)
    .filter((f) => f.endsWith('.prisma'))
    .map((f) => readFileSync(join(schemaDir, f), 'utf8'))
    .join('\n');
  const out: string[] = [];
  for (const m of src.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g))
    if (new RegExp(`^\\s+${field}\\s`, 'm').test(m[2] ?? '')) out.push(m[1]!);
  return out.sort();
}

describe('reach lists match the schema', () => {
  it('G4: every model with a branch is either filtered by reach or listed as free, with a reason', () => {
    const listed = [...Object.keys(BRANCH_SCOPED_MODELS), ...Object.keys(BRANCH_FREE_MODELS)].sort();
    expect(listed).toEqual(modelsWith('branchId'));
    for (const why of Object.values(BRANCH_FREE_MODELS)) expect(why.length).toBeGreaterThan(10);
  });

  it('G3: the whole group adds nothing; a list of branches adds those, rows with no branch, and my own rows', () => {
    expect(reachWhere('Task', null)).toBeNull();
    expect(reachWhere('Task', { userId: 'u1', branchIds: null })).toBeNull();
    expect(reachWhere('User', { userId: 'u1', branchIds: ['b1'] })).toBeNull();
    expect(reachWhere('Task', { userId: 'u1', branchIds: ['b1', 'b2'] })).toEqual({
      OR: [
        { branchId: null },
        { branchId: { in: ['b1', 'b2'] } },
        { doerId: 'u1' },
        { creatorId: 'u1' },
        { verifierId: 'u1' },
      ],
    });
    expect(reachWhere('MasterRow', { userId: 'u1', branchIds: [] })).toEqual({
      OR: [{ branchId: null }, { branchId: { in: [] } }],
    });
  });
});
