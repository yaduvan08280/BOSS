import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ME, type PackInput } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { ok } from '../branches/testkit';
import { world } from '../records/testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

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

describe('Industry packs: sharing, words, removing (phase 20)', { timeout: 90_000 }, () => {
  it('U40, U41, U42: two packs live in one company and share what both name; each brings its words and menu; removing one keeps everything it made', async () => {
    const w = await world(ctx.app);
    await ok(install(w, clinic()));
    const lab: PackInput = {
      key: 'lab',
      name: 'Laboratory',
      version: 1,
      industry: 'health',
      words: { 'res.guestName': { en: 'Sample of' }, 'res.mobile': { en: 'Contact number' } },
      // The same master by name: it is shared, not made twice, and its rows are left alone.
      masters: [
        {
          key: 'docs',
          name: 'doctors',
          fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
          rows: [{ name: 'Someone else' }],
        },
      ],
      recordTypes: [
        {
          key: 'sample',
          name: 'Sample',
          pluralName: 'Samples',
          prefix: 'SMP',
          definition: {
            fields: [
              {
                key: 'doctor',
                label: 'Sent by',
                type: 'master',
                master: 'm:@pack/master/docs',
                required: true,
              },
            ],
            tables: [],
            statuses,
            start: 'booked',
            moves: [{ from: 'booked', action: 'see', label: 'Mark seen', to: 'seen', who: ['edit'] }],
          },
        },
      ],
    };
    const r = await ok<Result>(install(w, lab));
    expect(r.kept).toEqual([{ kind: 'master', key: 'docs' }]);
    expect(r.made).toEqual([{ kind: 'rt', key: 'sample' }]);
    const companyId = w.companyId;
    expect(await ctx.prisma.masterDef.count({ where: { companyId, deletedAt: null } })).toBe(1);
    const master = await ctx.prisma.masterDef.findFirstOrThrow({ where: { companyId } });
    expect(await ctx.prisma.masterRow.count({ where: { masterId: master.id } })).toBe(2);
    // Each pack's record types sit in a menu section of its own name.
    type Menu =
      { section: string | null; items: { name: string }[] }[] | { section: string | null; name: string }[];
    const menu = JSON.stringify(await ok<Menu>(w.api.get('/api/records/menu')));
    expect(menu).toContain('Clinic');
    expect(menu).toContain('Laboratory');
    // Both packs' words: the later pack wins where both name a word.
    const words = async () =>
      (
        await ok<{ company: { words: Record<string, { en: string; hi?: string }> } }>(
          w.api.get('/api/auth/me'),
        )
      ).company.words;
    expect(await words()).toEqual({
      'res.guestName': { en: 'Sample of' },
      'res.mobile': { en: 'Contact number' },
    });
    const samples = await typeOf(w, 'SMP');
    await ok(w.api.post(`/api/records/types/${samples}/records`, { data: { doctor: 'Dr Rao' } }));

    // The laboratory pack is taken off: its words go, the clinic's come back; nothing it made is touched.
    expect((await (await w.person('Member')).api.del('/api/packs/lab')).status).toBe(403);
    expect(await ok<{ kept: number }>(w.api.del('/api/packs/lab'))).toMatchObject({ ok: true, kept: 2 });
    expect(await words()).toEqual({ 'res.guestName': { en: 'Patient name', hi: 'मरीज़ का नाम' } });
    expect(
      (await ok<{ installed: { key: string }[] }>(w.api.get('/api/packs'))).installed.map((p) => p.key),
    ).toEqual(['clinic']);
    expect(await ctx.prisma.recordType.count({ where: { companyId, prefix: 'SMP', deletedAt: null } })).toBe(
      1,
    );
    expect(
      await ctx.prisma.recordEntry.count({ where: { companyId, typeId: samples, deletedAt: null } }),
    ).toBe(1);
    expect((await w.api.del('/api/packs/lab')).status).toBe(404);
    // Put back later, it finds its things again and makes nothing twice.
    expect(await ok<Result>(install(w, lab))).toMatchObject({ made: [], upgradedFrom: null });
  });

  it('U37 (hospitality): the hospitality pack from the library switches the module on and brings the hotel’s roles, tax shells and checklists', async () => {
    const w = await world(ctx.app);
    const r = await ok<Result>(w.api.post('/api/packs/library/hospitality'));
    expect(r.made.filter((m) => m.kind === 'role')).toHaveLength(12);
    expect(r.made.filter((m) => m.kind === 'checklist')).toHaveLength(4);
    const me = await ok<{ company: { hospitality: boolean } }>(w.api.get('/api/auth/me'));
    expect(me.company.hospitality).toBe(true);
    const steward = await ctx.prisma.role.findFirstOrThrow({
      where: { companyId: w.companyId, name: 'Steward / captain' },
    });
    expect(steward.permissions).toEqual(expect.arrayContaining(['hosp.view', 'hosp.create']));
    expect(await ctx.prisma.taxRate.count({ where: { companyId: w.companyId } })).toBe(5);
    expect((await w.api.post('/api/packs/library/nope')).status).toBe(404);
  });
});
