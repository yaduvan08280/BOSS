import { describe, expect, it } from 'vitest';
import { TransitionError } from '../machines/transition';
import {
  buildRecordMachine,
  checkRecordDefinition,
  defaultColumns,
  defaultRecordDefinition,
  filterOpsFor,
  moveRecord,
  movesFor,
  recordAccess,
  recordDefinitionSchema,
  recordRoles,
  recordTitleOf,
  recordTypeInputSchema,
  recordTypeMachine,
  riskyChanges,
  type RecordDefinition,
} from './index';
import { transition } from '../machines/transition';

/** A site visit: planned → visited → approved, or cancelled; only an approver approves. */
const siteVisit = (): RecordDefinition =>
  recordDefinitionSchema.parse({
    fields: [
      { key: 'site', label: 'Site', type: 'text', required: true },
      { key: 'visit_on', label: 'Visit on', type: 'date' },
      { key: 'cost', label: 'Cost', type: 'amount' },
      { key: 'kind', label: 'Kind', type: 'dropdown', options: ['Survey', 'Repair'] },
    ],
    tables: [
      {
        key: 'findings',
        label: 'Findings',
        fields: [
          { key: 'what', label: 'What', type: 'text', required: true },
          { key: 'qty', label: 'Qty', type: 'number' },
        ],
      },
    ],
    statuses: [
      { key: 'planned', label: 'Planned', kind: 'info' },
      { key: 'visited', label: 'Visited', kind: 'warn' },
      { key: 'approved', label: 'Approved', kind: 'ok', final: true },
      { key: 'cancelled', label: 'Cancelled', kind: 'neutral', final: true },
    ],
    start: 'planned',
    moves: [
      { from: 'planned', action: 'visit', label: 'Mark visited', to: 'visited', who: ['edit', 'creator'] },
      { from: 'visited', action: 'approve', label: 'Approve', to: 'approved', who: ['approve'] },
      {
        from: 'visited',
        action: 'send_back',
        label: 'Send back',
        to: 'planned',
        who: ['approve'],
        noteRequired: true,
      },
      {
        from: 'planned',
        action: 'cancel',
        label: 'Cancel',
        to: 'cancelled',
        who: ['creator', 'role:roleabc123'],
        noteRequired: true,
      },
    ],
  });

describe('record type definition', () => {
  it('U1: the default definition and a full one are ready to use', () => {
    expect(checkRecordDefinition(defaultRecordDefinition())).toEqual([]);
    expect(checkRecordDefinition(siteVisit())).toEqual([]);
    const input = recordTypeInputSchema.parse({
      name: 'Site visit',
      pluralName: 'Site visits',
      prefix: 'SV',
      definition: siteVisit(),
      menu: { section: 'systems', icon: 'map-pin' },
    });
    expect(input.permissions).toBeUndefined();
  });

  it('U1: the shape is strict — unknown keys, bad prefixes, colours outside the fixed set are refused', () => {
    const base = {
      name: 'Trip',
      pluralName: 'Trips',
      definition: siteVisit(),
      menu: { section: null, icon: 'truck' },
    };
    expect(recordTypeInputSchema.safeParse({ ...base, prefix: 'sv' }).success).toBe(false);
    expect(recordTypeInputSchema.safeParse({ ...base, prefix: 'TOOLONGPREFIX' }).success).toBe(false);
    expect(recordTypeInputSchema.safeParse({ ...base, prefix: 'TR' }).success).toBe(true);
    expect(
      recordTypeInputSchema.safeParse({ ...base, prefix: 'TR', menu: { section: null, icon: 'skull' } })
        .success,
    ).toBe(false);
    const def = siteVisit();
    expect(
      recordDefinitionSchema.safeParse({ ...def, statuses: [{ key: 'a', label: 'A', kind: 'pink' }] })
        .success,
    ).toBe(false);
    expect(recordDefinitionSchema.safeParse({ ...def, surprise: true }).success).toBe(false);
    expect(
      recordDefinitionSchema.safeParse({
        ...def,
        moves: [{ from: 'planned', action: 'x', label: 'X', to: 'visited', who: ['nobody'] }],
      }).success,
    ).toBe(false);
  });

  it('U2: problems are named in words the person setting it up can act on', () => {
    const def = siteVisit();
    def.fields.push({ key: 'site', label: 'Site again', type: 'text', required: false });
    def.tables.push({ key: 'findings', label: 'Findings 2', fields: [] });
    def.statuses.push({ key: 'lost', label: 'Lost', kind: 'bad' });
    def.moves.push(
      { from: 'approved', action: 'reopen', label: 'Reopen', to: 'planned', who: ['approve'] },
      { from: 'planned', action: 'visit', label: 'Visit twice', to: 'visited', who: ['edit'] },
      { from: 'visited', action: 'vanish', label: 'Vanish', to: 'nowhere', who: ['edit'] },
      { from: 'visited', action: 'stay', label: 'Stay', to: 'visited', who: ['edit'] },
    );
    def.displayField = 'gone';
    def.columns = ['code', 'gone'];
    const problems = checkRecordDefinition(def);
    expect(problems).toEqual(
      expect.arrayContaining([
        'Two fields have the same key "site": remove one and add it again',
        'Two tables have the same key "findings": rename one',
        'The table "Findings 2" has no columns yet: add at least one',
        'No move leads to "Lost": add a move to it, or remove the status',
        'The move "Reopen" leaves "Approved", which is a final status: untick "final" or remove the move',
        '"Planned" has two moves with the same key "visit": remove one',
        'The move "Vanish" leads to a status that does not exist',
        'The move "Stay" leads back to the same status "Visited"',
        'The title field does not exist any more: choose another',
        'The list column "gone" does not exist any more: remove it',
      ]),
    );
    const noStart = { ...siteVisit(), start: 'nope' };
    expect(checkRecordDefinition(noStart)).toContain('Choose the status a new record starts in');
    const noChoices = siteVisit();
    noChoices.fields[3]!.options = [];
    expect(checkRecordDefinition(noChoices)[0]).toMatch(/list of choices with no choices/);
  });

  it('U2: the moves become a transition table run by the shared transition()', () => {
    const def = siteVisit();
    const machine = buildRecordMachine(def, 'Site visit');
    expect(machine.states).toEqual(['planned', 'visited', 'approved', 'cancelled']);
    expect(machine.terminal).toEqual(['approved', 'cancelled']);
    expect(machine.rules).toHaveLength(4);
    // An editor marks it visited; only an approver approves; a final status allows nothing more.
    expect(moveRecord(def, { from: 'planned', action: 'visit', roles: ['edit'] })).toMatchObject({
      from: 'planned',
      to: 'visited',
      move: { label: 'Mark visited' },
    });
    const fails = (from: string, action: string, roles: string[]) => {
      try {
        moveRecord(def, { from, action, roles });
      } catch (e) {
        return (e as TransitionError).code;
      }
      return 'ok';
    };
    expect(fails('visited', 'approve', ['edit', 'creator'])).toBe('FORBIDDEN_TRANSITION');
    expect(fails('visited', 'approve', ['approve'])).toBe('ok');
    expect(fails('planned', 'approve', ['approve', 'admin'])).toBe('INVALID_TRANSITION');
    expect(fails('approved', 'visit', ['admin'])).toBe('INVALID_TRANSITION');
    // Admins may make every move; a role named on a move may make it.
    expect(fails('visited', 'approve', ['admin'])).toBe('ok');
    expect(fails('planned', 'cancel', ['role:roleabc123'])).toBe('ok');
    expect(fails('planned', 'cancel', ['role:other00001', 'edit'])).toBe('FORBIDDEN_TRANSITION');
    expect(movesFor(def, 'planned', ['edit']).map((m) => m.action)).toEqual(['visit']);
    expect(movesFor(def, 'planned', ['creator']).map((m) => m.action)).toEqual(['visit', 'cancel']);
    expect(movesFor(def, 'approved', ['admin'])).toEqual([]);
  });

  it('U6: rights come from the type (a role or everyone), the Roles matrix, or records.admin', () => {
    const p = { view: ['*'], create: ['r1'], edit: ['r1'], approve: ['r2'] };
    const member = recordAccess(p, { granted: ['delegation.view'], roleId: 'r9' });
    expect(member).toMatchObject({ view: true, create: false, edit: false, approve: false, admin: false });
    const maker = recordAccess(p, { granted: [], roleId: 'r1' });
    expect(maker).toMatchObject({ view: true, create: true, edit: true, approve: false });
    const hod = recordAccess(p, { granted: [], roleId: 'r2' });
    expect(hod).toMatchObject({ view: true, create: false, approve: true });
    expect(recordAccess(p, { granted: ['records.admin'], roleId: 'r9' })).toMatchObject({
      view: true,
      create: true,
      edit: true,
      approve: true,
      admin: true,
    });
    expect(recordAccess(p, { granted: ['*'], roleId: null }).admin).toBe(true);
    // A right for every record type from the Roles matrix.
    expect(recordAccess(p, { granted: ['records.edit'], roleId: 'r9' }).edit).toBe(true);
    // Nobody makes, edits or approves what they can't see.
    const hidden = { view: ['r1'], create: ['*'], edit: ['*'], approve: ['*'] };
    expect(recordAccess(hidden, { granted: [], roleId: 'r9' })).toMatchObject({
      view: false,
      create: false,
      edit: false,
      approve: false,
    });
    expect(recordRoles(maker, true).sort()).toEqual(['creator', 'edit', 'role:r1']);
    expect(recordRoles(member, false)).toEqual(['role:r9']);
    expect(recordRoles(recordAccess(hidden, { granted: [], roleId: 'r9' }), true)).toEqual([]);
  });

  it('U1: a record type itself is archived and brought back through a machine', () => {
    expect(
      transition(recordTypeMachine, { from: 'ACTIVE', action: 'archive', roles: ['admin'], ctx: {} }).to,
    ).toBe('ARCHIVED');
    expect(() =>
      transition(recordTypeMachine, { from: 'ARCHIVED', action: 'archive', roles: ['admin'], ctx: {} }),
    ).toThrow(TransitionError);
  });

  it('U4: titles, default columns and the filters a field offers', () => {
    const def = siteVisit();
    expect(recordTitleOf(def, { site: ' Tonk mine ', cost: 5 }, 'SV/26-27/0001')).toBe('Tonk mine');
    expect(recordTitleOf(def, { cost: 5 }, 'SV/26-27/0001')).toBe('SV/26-27/0001');
    expect(recordTitleOf({ ...def, displayField: 'kind' }, { site: 'X', kind: 'Repair' }, 'c')).toBe(
      'Repair',
    );
    expect(defaultColumns(def)).toEqual([
      'code',
      'title',
      'status',
      'site',
      'visit_on',
      'cost',
      'kind',
      'createdAt',
    ]);
    expect(defaultColumns({ ...def, columns: ['code', 'cost'] })).toEqual(['code', 'cost']);
    expect(filterOpsFor(def.fields[2]!)).toEqual(['eq', 'gte', 'lte', 'filled', 'empty']);
    expect(filterOpsFor(def.fields[3]!)).toEqual(['eq', 'filled', 'empty']);
    expect(filterOpsFor(def.fields[0]!)).toContain('contains');
  });

  it('U1: changes that could hurt saved records are found; harmless ones are not', () => {
    const before = siteVisit();
    const after = siteVisit();
    after.fields = after.fields.filter((f) => f.key !== 'visit_on');
    after.fields[0] = { ...after.fields[0]!, type: 'longtext', label: 'Site name' }; // text → long text: fine
    after.fields[1] = { ...after.fields[1]!, type: 'text' }; // amount → text: not fine
    after.tables[0]!.fields = [{ key: 'what', label: 'What', type: 'number', required: false }];
    after.statuses = after.statuses.filter((s) => s.key !== 'cancelled');
    after.moves = after.moves.filter((m) => m.to !== 'cancelled');
    expect(riskyChanges(before, after)).toEqual([
      { kind: 'fieldRemoved', key: 'visit_on', label: 'Visit on', table: undefined },
      { kind: 'fieldType', key: 'cost', label: 'Cost', table: undefined, from: 'amount', to: 'text' },
      { kind: 'fieldType', key: 'what', label: 'What', table: 'findings', from: 'text', to: 'number' },
      { kind: 'fieldRemoved', key: 'qty', label: 'Qty', table: 'findings' },
      { kind: 'statusRemoved', key: 'cancelled', label: 'Cancelled' },
    ]);
    expect(riskyChanges(before, { ...before, tables: [] })).toEqual([
      { kind: 'tableRemoved', key: 'findings', label: 'Findings' },
    ]);
    const added = siteVisit();
    added.fields.push({ key: 'notes', label: 'Notes', type: 'longtext', required: false });
    expect(riskyChanges(before, added)).toEqual([]);
  });
});
