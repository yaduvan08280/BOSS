/**
 * `npm run seed:demo` — "Demo Industries": 25 people in 14 departments, 5 shifts, 4 branches, 19 designations
 * (CLAUDE.md §15). Flows, tasks, checklists, customers, leads and items are added by the phases that build them.
 * Safe to run again: does nothing if the company exists. Everyone with a login uses SEED_DEMO_PASSWORD (default Demo1234).
 */
import 'dotenv/config';
import { createPrisma, formatNumber, nextCounter } from '@mono/db';
import { bootstrapCompany, hashPassword } from '@mono/api/services';
import { gstinCheckDigit, hhmmToMinutes } from '@mono/shared';
import { seedDemoWork } from './seed-demo-work';
import { seedDemoEngine } from './seed-demo-engine';
import { seedDemoFms } from './seed-demo-fms';
import { seedDemoHr } from './seed-demo-hr';
import { seedDemoPay } from './seed-demo-pay';
import { seedDemoIms } from './seed-demo-ims';
import { seedDemoCrm } from './seed-demo-crm';
import { seedDemoRecords } from './seed-demo-records';
import { seedDemoBranches } from './seed-demo-branches';
import { seedDemoMoney } from './seed-demo-money';
import { seedDemoStock } from './seed-demo-stock';

const PASSWORD = process.env.SEED_DEMO_PASSWORD?.trim() || 'Demo1234';
const DEPARTMENTS = [
  'Admin',
  'Accounts',
  'Dispatch',
  'HR',
  'IT',
  'Logistics',
  'Maintenance',
  'Management',
  'Marketing',
  'Production',
  'Purchase',
  'Quality',
  'Sales',
  'Store',
];
const DESIGNATIONS = [
  'Managing Director',
  'Director',
  'Admin Manager',
  'Accountant',
  'Dispatch Manager',
  'HR Manager',
  'IT Administrator',
  'Logistics Manager',
  'Maintenance Head',
  'Fitter',
  'Marketing Manager',
  'Production Head',
  'Machine Operator',
  'Purchase Manager',
  'Quality Manager',
  'Quality Inspector',
  'Sales Manager',
  'Sales Executive',
  'Store Keeper',
];
const SHIFTS: [string, string, string][] = [
  ['Morning', '07:00', '15:00'],
  ['Evening', '15:00', '23:00'],
  ['Night', '23:00', '07:00'],
  ['Office', '09:30', '18:30'],
];
const COLORS = [
  '#E9A23B',
  '#2F5BD3',
  '#0F7B6C',
  '#B23A48',
  '#6E4BB8',
  '#5C8A2E',
  '#1695A3',
  '#D9822B',
  '#9C4F96',
  '#7A5C43',
];

// [name, mobile suffix, department, designation, role, HOD?, login?, also works in]
type P = [string, string, string, string | null, string, boolean, boolean, string[]?];
const PEOPLE: P[] = [
  ['Meena Goyal', '01', 'Management', 'Director', 'ADMIN', true, true],
  ['Anita Verma', '02', 'Admin', 'Admin Manager', 'HOD', true, true],
  ['Suresh Agarwal', '03', 'Accounts', 'Accountant', 'HOD', true, true],
  ['Pooja Jain', '04', 'Accounts', 'Accountant', 'MEMBER', false, false],
  ['Mahesh Yadav', '05', 'Dispatch', 'Dispatch Manager', 'HOD', true, true],
  ['Ravi Kumar', '06', 'Dispatch', null, 'MEMBER', false, false],
  ['Kavita Rathore', '07', 'HR', 'HR Manager', 'HOD', true, true],
  ['Nikhil Sharma', '08', 'IT', 'IT Administrator', 'ADMIN', true, true, ['Admin']],
  ['Vikram Singh', '09', 'Logistics', 'Logistics Manager', 'HOD', true, true],
  ['Ramesh Choudhary', '10', 'Maintenance', 'Maintenance Head', 'HOD', true, true],
  ['Sandeep Pal', '11', 'Maintenance', 'Fitter', 'MEMBER', false, true],
  ['Lalit Jangid', '12', 'Maintenance', 'Fitter', 'MEMBER', false, false],
  ['Neha Kapoor', '13', 'Marketing', 'Marketing Manager', 'HOD', true, true],
  ['Ajay Meena', '14', 'Production', 'Production Head', 'HOD', true, true],
  ['Deepak Saini', '15', 'Production', 'Machine Operator', 'SUPERVISOR', false, true, ['Quality']],
  ['Manoj Kumawat', '16', 'Production', 'Machine Operator', 'MEMBER', false, false],
  ['Amit Khandelwal', '17', 'Purchase', 'Purchase Manager', 'HOD', true, true],
  ['Priya Sharma', '18', 'Quality', 'Quality Manager', 'HOD', true, true],
  ['Harish Joshi', '19', 'Quality', 'Quality Inspector', 'MEMBER', false, false],
  ['Rohit Mittal', '20', 'Sales', 'Sales Manager', 'HOD', true, true],
  ['Sunita Bansal', '21', 'Sales', 'Sales Executive', 'EA', false, true],
  ['Arjun Rawat', '22', 'Sales', 'Sales Executive', 'MEMBER', false, false],
  ['Gopal Prajapat', '23', 'Store', 'Store Keeper', 'MEMBER', false, true],
  ['Sanjay Tak', '24', 'Store', 'Store Keeper', 'MEMBER', false, false],
];

const prisma = createPrisma();
try {
  const { company, owner, created } = await bootstrapCompany(prisma, {
    companyName: 'Demo Industries',
    ownerName: 'Rajesh Goyal',
    ownerMobile: '9000000000',
    ownerEmail: 'owner@demo.mono',
    ownerPassword: PASSWORD,
  });
  if (!created) {
    console.log('Demo Industries already exists.');
  } else {
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.$transaction(
      async (tx) => {
        const id = company.id;
        const first14 = '08AADCD4321K1Z';
        await tx.company.update({
          where: { id },
          data: {
            city: 'Jaipur',
            state: 'Rajasthan',
            ownerName: 'Rajesh Goyal',
            mobile: '+919000000000',
            email: 'office@demo.mono',
            gstin: first14 + gstinCheckDigit(first14),
            pan: 'AADCD4321K',
            legalName: 'Demo Industries Private Limited',
          },
        });
        await tx.companyContact.createMany({
          data: [
            { companyId: id, role: 'Accounts', name: 'Suresh Agarwal', phone: '+919000000103', sortOrder: 0 },
            { companyId: id, role: 'Dispatch', name: 'Mahesh Yadav', phone: '+919000000105', sortOrder: 1 },
          ],
        });
        for (const [name, start, end] of SHIFTS) {
          await tx.shift.create({
            data: { companyId: id, name, startMin: hhmmToMinutes(start), endMin: hhmmToMinutes(end) },
          });
        }
        const ho = await tx.branch.create({
          data: {
            companyId: id,
            name: 'Head Office',
            code: 'HO',
            city: 'Jaipur',
            state: 'Rajasthan',
            isDefault: true,
          },
        });
        for (const [name, code, city, state] of [
          ['Plant', 'KSG', 'Kishangarh', 'Rajasthan'],
          ['Warehouse', 'AJM', 'Ajmer', 'Rajasthan'],
          ['Sales Office', 'DEL', 'New Delhi', 'Delhi'],
        ]) {
          await tx.branch.create({
            data: { companyId: id, name: name!, code, city, state, parentId: ho.id },
          });
        }
        const dept = new Map<string, string>();
        for (const [i, name] of DEPARTMENTS.entries()) {
          dept.set(
            name,
            (
              await tx.department.create({
                data: { companyId: id, name, sortOrder: i, color: COLORS[i % COLORS.length] },
              })
            ).id,
          );
        }
        const desig = new Map<string, string>();
        for (const [i, name] of DESIGNATIONS.entries()) {
          desig.set(
            name,
            (await tx.designation.create({ data: { companyId: id, name, color: COLORS[i % COLORS.length] } }))
              .id,
          );
        }
        const roles = new Map(
          (await tx.role.findMany({ where: { companyId: id } })).map((r) => [r.key, r.id]),
        );
        await tx.user.update({
          where: { id: owner!.id },
          data: { mainDepartmentId: dept.get('Management'), designationId: desig.get('Managing Director') },
        });
        const general = await tx.shift.findFirstOrThrow({ where: { companyId: id, isDefault: true } });

        for (const [name, suffix, d, des, role, hod, login, also] of PEOPLE) {
          const user = await tx.user.create({
            data: {
              companyId: id,
              code: formatNumber('EMP', await nextCounter(tx, id, 'user')),
              name,
              mobile: `+9190000001${suffix}`,
              email: login ? `${name.split(' ')[0]!.toLowerCase()}@demo.mono` : null,
              roleId: roles.get(role)!,
              mainDepartmentId: dept.get(d),
              designationId: des ? desig.get(des) : null,
              reportsToId: owner!.id,
              branchId: ho.id,
              shiftId: general.id,
              loginEnabled: login,
              passwordHash: login ? passwordHash : null,
              hr: { doj: '2023-04-01', biometricId: `B-${suffix}` },
            },
          });
          for (const other of also ?? [])
            await tx.userDepartment.create({
              data: { companyId: id, userId: user.id, departmentId: dept.get(other)! },
            });
          if (hod) await tx.department.update({ where: { id: dept.get(d) }, data: { hodUserId: user.id } });
        }
      },
      { timeout: 60_000 },
    );
    console.log(
      `Created Demo Industries: 25 people, 14 departments. Sign in with 9000000000 / ${PASSWORD} (owner) or any HOD mobile 90000001xx.`,
    );
  }
  // Each phase's demo data, added once (safe to re-run).
  if (await seedDemoWork(prisma, company.id)) console.log('Added demo tasks, checklists and holidays.');
  if (await seedDemoEngine(prisma, company.id))
    console.log('Added demo help slips, tickets and the EA board.');
  if (await seedDemoFms(prisma, company.id)) console.log('Added 8 demo processes with running records.');
  if (await seedDemoHr(prisma, company.id))
    console.log('Added demo attendance, leave with a Buddy, and HR rules.');
  if (await seedDemoPay(prisma, company.id))
    console.log('Added demo pay: salaries, daily wages, pay rules and leave by designation.');
  if (await seedDemoIms(prisma, company.id))
    console.log(
      'Added demo inventory: 50 items with 120 days of stock history, orders, reviews and an audit.',
    );
  if (await seedDemoCrm(prisma, company.id))
    console.log('Added demo sales CRM: an approved ₹7.5 Cr plan, 24 customers with order history, 20 leads.');
  if (await seedDemoRecords(prisma, company.id))
    console.log('Added a demo record type (Site visits) with 14 records and two saved reports.');
  if (await seedDemoBranches(prisma, company.id))
    console.log(
      'Added a sample group: two Indian entities, a franchise and a company abroad, each with an outlet.',
    );
  if (await seedDemoMoney(prisma, company.id))
    console.log('Added demo money set-up: GST rates, payment modes and two vendors.');
  if (await seedDemoStock(prisma, company.id))
    console.log(
      'Added demo stock by location: a store and a bar, a whisky in ml with a peg recipe, a gold rate.',
    );
} finally {
  await prisma.$disconnect();
}
