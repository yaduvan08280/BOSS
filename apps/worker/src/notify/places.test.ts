import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@mono/db';
import { bootstrapCompany } from '@mono/api/services';
import { resolveRecipients } from './recipients';

const db = createPrisma();
afterAll(async () => db.$disconnect());

describe('people of a place as notification recipients (phase 12)', () => {
  it('G11, G12: branch manager, area manager, branch HR and the department head at the branch', async () => {
    const tag = `${Date.now() % 1_000_000}`;
    const { company } = await bootstrapCompany(db, {
      companyName: `Places ${tag}`,
      ownerName: 'Owner',
      ownerEmail: `pl${tag}@x.in`,
      ownerPassword: 'Secret123',
    });
    const companyId = company.id;
    const member = await db.role.findFirstOrThrow({ where: { companyId, key: 'MEMBER' } });
    const person = (name: string, more: object = {}) =>
      db.user.create({ data: { companyId, code: `${name}-${tag}`, name, roleId: member.id, ...more } });
    const region = await db.region.create({ data: { companyId, name: 'Rajasthan' } });
    const jaipur = await db.region.create({ data: { companyId, name: 'Jaipur', parentId: region.id } });
    const rooftop = await db.branch.create({ data: { companyId, name: 'Rooftop', regionId: jaipur.id } });
    const lake = await db.branch.create({ data: { companyId, name: 'Lake' } });
    const [manager, area, hr, chef, groupChef, otherManager] = await Promise.all(
      ['Manager', 'Area', 'Hr', 'Chef', 'GroupChef', 'OtherManager'].map((n) => person(n)),
    );
    const kitchen = await db.department.create({
      data: { companyId, name: `Kitchen ${tag}`, hodUserId: groupChef!.id },
    });
    const cook = await person('Cook', { branchId: rooftop.id, mainDepartmentId: kitchen.id });
    const steward = await person('Steward', { branchId: lake.id, mainDepartmentId: kitchen.id });
    await db.branchManager.createMany({
      data: [
        { companyId, userId: manager!.id, branchId: rooftop.id, role: 'MANAGER' },
        { companyId, userId: otherManager!.id, branchId: lake.id, role: 'MANAGER' },
        { companyId, userId: hr!.id, branchId: rooftop.id, role: 'HR' },
        // An area manager two regions up still counts.
        { companyId, userId: area!.id, regionId: region.id, role: 'AREA' },
      ],
    });
    await db.departmentHead.create({
      data: { companyId, departmentId: kitchen.id, branchId: rooftop.id, userId: chef!.id },
    });
    const to = async (key: string, payload: Record<string, unknown>) =>
      (await resolveRecipients(db, companyId, [key], payload, null)).people.map((p) => p.name).sort();

    // The event is about the cook (rooftop, kitchen).
    const about = { doerId: cook.id };
    expect(await to('branch_manager', about)).toEqual(['Manager']);
    expect(await to('area_manager', about)).toEqual(['Area']);
    expect(await to('branch_hr', about)).toEqual(['Hr']);
    // The kitchen's head at the rooftop; at the lake (none set there) the department's group-wide head.
    expect(await to('department_head', about)).toEqual(['Chef']);
    expect(await to('department_head', { doerId: steward.id })).toEqual(['GroupChef']);
    expect(await to('branch_manager', { doerId: steward.id })).toEqual(['OtherManager']);
    expect(await to('area_manager', { doerId: steward.id })).toEqual([]);
    // An event that names its branch is read from that branch, whoever it is about.
    expect(await to('branch_manager', { doerId: steward.id, branchId: rooftop.id })).toEqual(['Manager']);
    // An approval route's people stand in for "HOD".
    expect(await to('hod', { userId: cook.id, approverIds: [manager!.id] })).toEqual(['Manager']);
  });
});
