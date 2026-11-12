import type { PrismaClient } from '@mono/db';
import type { world } from '../records/testkit';

export type World = Awaited<ReturnType<typeof world>>;
export const ok = async <T>(p: Promise<{ status: number; body: T }>): Promise<T> => {
  const r = await p;
  if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

/** A small hotel group: one entity, two regions, four branches, people at each. */
export async function group(w: World) {
  const entity = await ok<{ id: string }>(
    w.api.post('/api/branches/entities', {
      name: 'GGM Hotels Rajasthan',
      state: 'Rajasthan',
      taxId: '08AAAAA0000A1Z5',
    }),
  );
  const region = (name: string, parentId?: string) =>
    ok<{ id: string }>(w.api.post('/api/branches/regions', { name, entityId: entity.id, parentId }));
  const raj = await region('Rajasthan');
  const jaipur = await region('Jaipur', raj.id);
  const ajmer = await region('Ajmer', raj.id);
  const branch = (name: string, type: string, regionId: string) =>
    ok<{ id: string }>(w.api.post('/api/org/branches', { name, type, entityId: entity.id, regionId }));
  const b = {
    rooftop: await branch('Rooftop Jaipur', 'OUTLET', jaipur.id),
    garden: await branch('Garden Jaipur', 'OUTLET', jaipur.id),
    lake: await branch('Lake View Ajmer', 'OUTLET', ajmer.id),
    kitchen: await branch('Central Kitchen', 'KITCHEN', ajmer.id),
  };
  const at = async (name: string, branchId: string, role = 'MEMBER') => {
    const p = await w.person(name, role);
    await ok(w.api.put(`/api/branches/people/${p.id}`, { homeBranchId: branchId, alsoBranchIds: [] }));
    return p;
  };
  return { entity, raj, jaipur, ajmer, b, at };
}
export const reachOf = (w: World, key: string, reach: string) =>
  ok(w.api.patch(`/api/org/roles/${w.role(key)}`, { reach }));
export const give = (w: World, doerId: string, description: string) =>
  ok<{ id: string }>(
    w.api.post('/api/tasks', {
      doerId,
      plannedAt: new Date(Date.now() + 86_400_000).toISOString(),
      description,
    }),
  );
export const tasks = async (api: World['api']) =>
  ((await ok<{ tasks: { description: string }[] }>(api.get('/api/tasks?scope=all&tab=all'))).tasks ?? [])
    .map((t) => t.description)
    .sort();

/** Two outlets with a "my branches" manager each (HODs who may otherwise see every process and record). */
export async function twoOutlets(prisma: PrismaClient, w: World) {
  const g = await group(w);
  const hod = await prisma.role.findUniqueOrThrow({ where: { id: w.role('HOD') } });
  await ok(
    w.api.patch(`/api/org/roles/${hod.id}`, {
      permissions: [
        ...new Set([
          ...hod.permissions,
          'fms.admin',
          'records.admin',
          'reports.admin',
          'core.admin',
          'org.edit',
        ]),
      ],
    }),
  );
  await reachOf(w, 'HOD', 'branches');
  const rooftop = await g.at('Farah Rooftop', g.b.rooftop.id, 'HOD');
  const lake = await g.at('Leela Lake', g.b.lake.id, 'HOD');
  return { g, rooftop, lake };
}
