import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ME, type PackInput } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { ok } from '../branches/testkit';
import { world } from '../records/testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
// The checklists a pack makes are daily ones: left switched on they would be swept for ever in the test
// database (and slow every test that sweeps). Only the packs' own are switched off, by name.
afterAll(async () => {
  await ctx.prisma.checklistMaster.updateMany({
    where: {
      active: true,
      name: {
        in: [
          'Clinic opening',
          'Restaurant opening',
          'Restaurant closing',
          'Front desk morning',
          'Housekeeping morning',
        ],
      },
    },
    data: { active: false },
  });
  await ctx.app.close();
});

type Result = {
  version: number;
  made: { kind: string; key: string }[];
  kept: { kind: string; key: string }[];
  upgradedFrom: number | null;
};
type World = Awaited<ReturnType<typeof world>>;
const statuses = [
  { key: 'booked', label: 'Booked', kind: 'info' },
  { key: 'seen', label: 'Seen', kind: 'ok', final: true },
];
/** A small clinic: doctors, an appointment that picks a doctor, a visit process, a report, a role, the trade's word. */
const clinic = (over: Partial<PackInput> = {}): PackInput => ({
  key: 'clinic',
  name: 'Clinic',
  version: 1,
  industry: 'health',
  words: { 'res.guestName': { en: 'Patient name', hi: 'मरीज़ का नाम' } },
  roles: [{ key: 'receptionist', name: 'Receptionist', permissions: ['records.view', 'records.create'] }],
  taxCodes: [{ code: 'CONSULT', name: 'GST on consultation' }],
  lists: [{ key: 'list:clinic_reason', values: ['Fever', 'Check-up'] }],
  masters: [
    {
      key: 'doctors',
      name: 'Doctors',
      fields: [
        { key: 'code', label: 'Code', type: 'text', required: true },
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'fee', label: 'Fee', type: 'amount' },
      ],
      keyField: 'code',
      displayField: 'name',
      rows: [
        { code: 'D1', name: 'Dr Mehta', fee: 500 },
        { code: 'D2', name: 'Dr Rao', fee: 700 },
      ],
    },
  ],
  items: [
    {
      code: 'SYR5',
      name: 'Syringe 5 ml',
      unit: 'nos',
      extras: { tracking: 'BATCH', taxCode: 'CONSULT', hsn: '9018' },
    },
  ],
  recordTypes: [
    {
      key: 'appointment',
      name: 'Appointment',
      pluralName: 'Appointments',
      prefix: 'APT',
      definition: {
        fields: [
          { key: 'patient', label: 'Patient', type: 'text', required: true, reportable: true },
          {
            key: 'doctor',
            label: 'Doctor',
            type: 'master',
            master: 'm:@pack/master/doctors',
            required: true,
            reportable: true,
          },
        ],
        tables: [],
        statuses,
        start: 'booked',
        moves: [{ from: 'booked', action: 'see', label: 'Mark seen', to: 'seen', who: ['edit', 'creator'] }],
      },
      permissions: {
        view: ['*'],
        create: ['@pack/role/receptionist'],
        edit: ['*'],
        approve: ['@pack/role/receptionist'],
      },
    },
  ],
  flows: [
    {
      key: 'visit',
      name: 'Patient visit',
      runName: 'Visit',
      definition: {
        timeModel: 'calendar',
        startFields: [{ key: 'patient', label: 'Patient', type: 'text', required: true }],
        steps: [
          {
            key: 'consult',
            name: 'Consultation',
            type: 'TASK',
            doerIds: [ME],
            time: { value: 1, unit: 'hours', anchor: 'previous' },
          },
        ],
      },
    },
  ],
  checklists: [
    {
      key: 'opening',
      name: 'Clinic opening',
      input: {
        items: [{ key: 'a', text: 'Sterilise instruments' }],
        frequency: { type: 'daily' },
        dueTime: '09:00',
        windowHours: 2,
        doerIds: [ME],
        startDate: '2026-01-01',
      },
    },
  ],
  reports: [
    {
      key: 'by_doctor',
      name: 'Appointments by doctor',
      definition: {
        source: { kind: 'recordType', id: '@pack/rt/appointment' },
        columns: [],
        filters: [],
        groupBy: { field: 'doctor' },
        measures: [{ fn: 'count' }],
        look: 'table',
      },
    },
  ],
  ...over,
});
const install = (w: World, pack: object) => w.api.post('/api/packs/install', pack);
const typeOf = async (w: World, prefix: string) =>
  (await ok<{ types: { id: string; prefix: string }[] }>(w.api.get('/api/records/types'))).types.find(
    (t) => t.prefix === prefix,
  )!.id;
const appointments = (w: World) => typeOf(w, 'APT');

describe('Industry packs (phase 20)', { timeout: 90_000 }, () => {
  it('U37: a pack installs into an empty company — roles, tax shells, lists, a master with rows, items, a record type, a process, a checklist and a report, all pointing at each other', async () => {
    const w = await world(ctx.app);
    const member = await w.person('Not An Admin');
    expect((await member.api.post('/api/packs/install', clinic())).status).toBe(403);
    expect((await install(w, { key: 'x' })).status).toBe(400);
    const r = await ok<Result>(install(w, clinic()));
    expect(r).toMatchObject({ version: 1, upgradedFrom: null, kept: [] });
    expect(r.made.map((m) => m.kind).filter((k) => k !== 'list')).toEqual([
      'role',
      'tax',
      'master',
      'item',
      'flow',
      'rt',
      'checklist',
      'report',
    ]);
    const companyId = w.companyId;
    // The tax code is a shell at 0 % for the accountant; the item is tracked by batch.
    expect(
      await ctx.prisma.taxRate.findFirstOrThrow({ where: { companyId, code: 'CONSULT' } }),
    ).toMatchObject({ percent: expect.anything() });
    expect(
      Number((await ctx.prisma.taxRate.findFirstOrThrow({ where: { companyId, code: 'CONSULT' } })).percent),
    ).toBe(0);
    expect(await ctx.prisma.item.findFirstOrThrow({ where: { companyId, code: 'SYR5' } })).toMatchObject({
      tracking: 'BATCH',
      hsn: '9018',
    });
    const master = await ctx.prisma.masterDef.findFirstOrThrow({ where: { companyId, name: 'Doctors' } });
    expect(await ctx.prisma.masterRow.count({ where: { masterId: master.id } })).toBe(2);
    // The record type picks from the pack's own master, and its rights name the pack's own role.
    const role = await ctx.prisma.role.findFirstOrThrow({ where: { companyId, name: 'Receptionist' } });
    const typeId = await appointments(w);
    const type = await ok<{
      definition: { fields: { key: string; master?: string }[] };
      permissions: { create: string[] };
      menu: { section: string };
    }>(w.api.get(`/api/records/types/${typeId}`));
    expect(type.definition.fields[1]).toMatchObject({ master: `m:${master.id}` });
    expect(type.permissions.create).toEqual([role.id]);
    expect(type.menu.section).toBe('Clinic');
    // It works at once: an appointment with a doctor from the master, and the pack's report counts it.
    const made = await w.api.post(`/api/records/types/${typeId}/records`, {
      data: { patient: 'Asha', doctor: 'Dr Mehta' },
    });
    expect(made.status).toBe(200);
    const report = await ctx.prisma.report.findFirstOrThrow({
      where: { companyId, name: 'Appointments by doctor' },
    });
    const ran = await ok<{ result: { rows: unknown[][] } }>(w.api.get(`/api/reports/${report.id}/run`));
    expect(ran.result.rows).toEqual([['Dr Mehta', 1]]);
    // The process is published with the installer as its doer, and the checklist is his.
    const flow = await ctx.prisma.flow.findFirstOrThrow({ where: { companyId, name: 'Patient visit' } });
    expect(flow).toMatchObject({ status: 'PUBLISHED', version: 1 });
    expect(
      await ctx.prisma.checklistMaster.findFirstOrThrow({ where: { companyId, name: 'Clinic opening' } }),
    ).toMatchObject({
      doerIds: [w.owner.id],
    });
    const list = await ok<{ installed: { key: string; version: number }[]; library: { key: string }[] }>(
      w.api.get('/api/packs'),
    );
    expect(list.installed).toMatchObject([{ key: 'clinic', version: 1 }]);
    expect(list.library.map((p) => p.key)).toContain('hospitality');
  });

  it('U38: an upgrade adds only what is new — what the company changed stays as it is, and the same version again changes nothing', async () => {
    const w = await world(ctx.app);
    await ok(install(w, clinic()));
    const companyId = w.companyId;
    // The company renames a doctor and changes the role.
    const master = await ctx.prisma.masterDef.findFirstOrThrow({ where: { companyId, name: 'Doctors' } });
    const row = await ctx.prisma.masterRow.findFirstOrThrow({ where: { masterId: master.id, key: 'D1' } });
    await ok(
      w.api.put(`/api/masters/${master.id}/rows/${row.id}`, { code: 'D1', name: 'Dr Mehta (Sr)', fee: 900 }),
    );
    const role = await ctx.prisma.role.findFirstOrThrow({ where: { companyId, name: 'Receptionist' } });
    await ok(w.api.patch(`/api/org/roles/${role.id}`, { permissions: ['records.view'] }));
    // The same version again: nothing made.
    expect(await ok<Result>(install(w, clinic()))).toMatchObject({ made: [], upgradedFrom: 1 });
    // Version 2 brings a nurse role, a new master and one more list value; version 1 is refused afterwards.
    const v2 = clinic({
      version: 2,
      roles: [
        {
          key: 'receptionist',
          name: 'Receptionist',
          permissions: ['records.view', 'records.create', 'records.edit'],
        },
        { key: 'nurse', name: 'Nurse', permissions: ['records.view'] },
      ],
      lists: [{ key: 'list:clinic_reason', values: ['Fever', 'Check-up', 'Vaccination'] }],
      masters: [
        ...clinic().masters!,
        {
          key: 'tests',
          name: 'Lab tests',
          fields: [{ key: 'name', label: 'Test', type: 'text', required: true }],
          rows: [{ name: 'CBC' }],
        },
      ],
    });
    const up = await ok<Result>(install(w, v2));
    expect(up).toMatchObject({ version: 2, upgradedFrom: 1 });
    expect(up.made).toEqual([
      { kind: 'role', key: 'nurse' },
      { kind: 'list', key: 'list:clinic_reason:vaccination' },
      { kind: 'master', key: 'tests' },
    ]);
    expect((await ctx.prisma.masterRow.findUniqueOrThrow({ where: { id: row.id } })).data).toMatchObject({
      name: 'Dr Mehta (Sr)',
    });
    expect(await ctx.prisma.masterRow.count({ where: { masterId: master.id, deletedAt: null } })).toBe(2);
    expect((await ctx.prisma.role.findUniqueOrThrow({ where: { id: role.id } })).permissions).toEqual([
      'records.view',
    ]);
    expect((await install(w, clinic())).status).toBe(409);
    expect(await ctx.prisma.packInstall.count({ where: { companyId } })).toBe(1);
  });

  it('U39: a company’s set-up is exported as a pack file and installed in another company, where it works', async () => {
    const a = await world(ctx.app);
    await ok(install(a, clinic()));
    // Something the first company built by itself travels too.
    await ok(
      a.api.post('/api/records/types', {
        name: 'Referral',
        pluralName: 'Referrals',
        prefix: 'REF',
        definition: {
          fields: [
            { key: 'patient', label: 'Patient', type: 'text', required: true },
            {
              key: 'appointment',
              label: 'Appointment',
              type: 'master',
              master: `rt:${await appointments(a)}`,
            },
          ],
          tables: [],
          statuses,
          start: 'booked',
          moves: [{ from: 'booked', action: 'see', label: 'Mark seen', to: 'seen', who: ['edit'] }],
        },
        menu: { section: 'Clinic', icon: 'file-text' },
      }),
    );
    const file = await ok<PackInput & { masters: { rows: unknown[] }[] }>(
      a.api.post('/api/packs/export', { key: 'my_clinic', name: 'My clinic', rows: true }),
    );
    const text = JSON.stringify(file);
    // No id of the first company, and none of its people, is in the file.
    for (const id of [a.companyId, a.owner.id, await appointments(a)]) expect(text).not.toContain(id);
    expect(text).toContain('@pack/rt/appointment');
    expect(text).toContain('@pack/me');
    expect(file.masters[0]!.rows).toHaveLength(2);
    // Without rows by default.
    expect(
      (await ok<typeof file>(a.api.post('/api/packs/export', { key: 'my_clinic', name: 'My clinic' })))
        .masters[0]!.rows,
    ).toEqual([]);

    const b = await world(ctx.app);
    const r = await ok<Result>(install(b, file));
    expect(r.made.filter((m) => m.kind === 'rt').map((m) => m.key)).toEqual(['appointment', 'referral']);
    const types = await ok<{ types: { id: string; prefix: string }[] }>(b.api.get('/api/records/types'));
    const apt = types.types.find((t) => t.prefix === 'APT')!.id;
    const ref = types.types.find((t) => t.prefix === 'REF')!.id;
    const made = await ok<{ code: string }>(
      b.api.post(`/api/records/types/${apt}/records`, { data: { patient: 'Asha', doctor: 'Dr Rao' } }),
    );
    // The referral picks the other company's own appointment — the link was rebuilt.
    expect(
      (
        await b.api.post(`/api/records/types/${ref}/records`, {
          data: { patient: 'Asha', appointment: made.code },
        })
      ).status,
    ).toBe(200);
    expect(
      await ctx.prisma.flow.findFirstOrThrow({ where: { companyId: b.companyId, name: 'Patient visit' } }),
    ).toMatchObject({ status: 'PUBLISHED' });
    // The words went with it.
    const me = await ok<{ company: { words: Record<string, { en: string }> } }>(b.api.get('/api/auth/me'));
    expect(me.company.words['res.guestName']).toMatchObject({ en: 'Patient name' });
  });
});
