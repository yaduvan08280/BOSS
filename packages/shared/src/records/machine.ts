import { hasPermission } from '../permissions';
import {
  availableActions,
  defineMachine,
  transition,
  type Machine,
  type TransitionResult,
} from '../machines/transition';
import {
  EVERYONE,
  type RecordDefinition,
  type RecordMove,
  type RecordPermissions,
  type RecordRight,
} from './definition';

/**
 * A record type's statuses and moves as a transition table, so every status change runs through the shared
 * `transition()` like the built-in modules (CLAUDE.md §2). Roles are the move's `who` tokens plus `admin`.
 */
export type RecordMachine = Machine<string, string, string, Record<string, never>>;

export function buildRecordMachine(def: RecordDefinition, name = 'record'): RecordMachine {
  return defineMachine<string, string, string>({
    name,
    states: def.statuses.map((s) => s.key),
    terminal: def.statuses.filter((s) => s.final).map((s) => s.key),
    rules: def.moves.map((m) => ({ from: m.from, action: m.action, to: m.to, roles: [...m.who, 'admin'] })),
  });
}

/** What the person may do with this type's records, worked out once per request. */
export type RecordAccess = Record<RecordRight, boolean> & { admin: boolean; roleId: string | null };

/**
 * A right is held by: record admins (`records.admin`, the owner), a role that has the right for every record
 * type (`records.view` … in the Roles matrix), or a role the type itself names (or "everyone").
 */
export function recordAccess(
  permissions: RecordPermissions,
  person: { granted: readonly string[]; roleId: string | null },
): RecordAccess {
  const admin = hasPermission(person.granted, 'records.admin');
  const has = (right: RecordRight) =>
    admin ||
    person.granted.includes(`records.${right}`) ||
    permissions[right].includes(EVERYONE) ||
    (person.roleId !== null && permissions[right].includes(person.roleId));
  // Nobody makes, edits or approves what they can't see.
  const view = has('view');
  return {
    admin,
    roleId: person.roleId,
    view,
    create: view && has('create'),
    edit: view && has('edit'),
    approve: view && has('approve'),
  };
}

/** The machine roles a person holds on one record. */
export function recordRoles(access: RecordAccess, isCreator: boolean): string[] {
  return [
    ...(access.admin ? ['admin'] : []),
    ...(access.edit ? ['edit'] : []),
    ...(access.approve ? ['approve'] : []),
    ...(isCreator && access.view ? ['creator'] : []),
    ...(access.roleId && access.view ? [`role:${access.roleId}`] : []),
  ];
}

/** Make a move: the next status, or a `TransitionError` (not allowed from here / not for this person). */
export function moveRecord(
  def: RecordDefinition,
  input: { from: string; action: string; roles: readonly string[] },
  name = 'record',
): TransitionResult<string, string> & { move: RecordMove } {
  const res = transition(buildRecordMachine(def, name), { ...input, ctx: {} });
  const move = def.moves.find((m) => m.from === input.from && m.action === input.action)!;
  return { ...res, move };
}

/** A record type itself is in use or archived (archived: kept with its records, no new ones, off the menu). */
export const RECORD_TYPE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type RecordTypeStatus = (typeof RECORD_TYPE_STATUSES)[number];
export const recordTypeMachine = defineMachine<RecordTypeStatus, 'archive' | 'restore', 'admin'>({
  name: 'recordType',
  states: RECORD_TYPE_STATUSES,
  rules: [
    { from: 'ACTIVE', action: 'archive', to: 'ARCHIVED', roles: ['admin'] },
    { from: 'ARCHIVED', action: 'restore', to: 'ACTIVE', roles: ['admin'] },
  ],
});

/** The moves this person may make from a status right now (the buttons to show). */
export function movesFor(def: RecordDefinition, from: string, roles: readonly string[]): RecordMove[] {
  const actions = availableActions(buildRecordMachine(def), from, roles, {});
  return def.moves.filter((m) => m.from === from && actions.includes(m.action));
}
