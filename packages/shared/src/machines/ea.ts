import { defineMachine } from './transition';

/** CLAUDE.md §5.5: the owner's capture board, sorted and run by the EA. */
export const EA_STAGES = [
  'CAPTURED',
  'INFORMATION',
  'SOMEDAY',
  'WAITING',
  'SCHEDULED',
  'DELEGATED',
  'DONE',
  'CLOSED',
] as const;
export type EaStage = (typeof EA_STAGES)[number];
export const EA_ACTIONS = [
  'toInformation',
  'toSomeday',
  'toWaiting',
  'schedule',
  'delegate',
  'done',
  'close',
  'reopen',
  'missDay',
  'expire',
] as const;
export type EaAction = (typeof EA_ACTIONS)[number];
export type EaRole = 'owner' | 'ea' | 'admin' | 'system';
export type EaContext = {
  informationStage: boolean;
  waitingStage: boolean;
  /** Fewer items waiting than the cap. */
  waitingRoom: boolean;
  missedDayToSomeday: boolean;
};

export const EA_LIVE = ['CAPTURED', 'INFORMATION', 'SOMEDAY', 'WAITING', 'SCHEDULED', 'DELEGATED'] as const;
const PEOPLE: EaRole[] = ['owner', 'ea', 'admin'];

export const eaMachine = defineMachine<EaStage, EaAction, EaRole, EaContext>({
  name: 'ea',
  states: EA_STAGES,
  terminal: ['CLOSED'],
  rules: [
    {
      from: ['CAPTURED', 'SOMEDAY', 'WAITING', 'SCHEDULED'],
      action: 'toInformation',
      to: 'INFORMATION',
      roles: PEOPLE,
      guard: (c) => c.informationStage,
    },
    {
      from: ['CAPTURED', 'INFORMATION', 'WAITING', 'SCHEDULED'],
      action: 'toSomeday',
      to: 'SOMEDAY',
      roles: PEOPLE,
    },
    {
      from: ['CAPTURED', 'INFORMATION', 'SOMEDAY', 'SCHEDULED'],
      action: 'toWaiting',
      to: 'WAITING',
      roles: PEOPLE,
      guard: (c) => c.waitingStage && c.waitingRoom,
    },
    {
      from: ['CAPTURED', 'INFORMATION', 'SOMEDAY', 'WAITING', 'SCHEDULED'],
      action: 'schedule',
      to: 'SCHEDULED',
      roles: PEOPLE,
    },
    {
      from: ['CAPTURED', 'SOMEDAY', 'WAITING', 'SCHEDULED'],
      action: 'delegate',
      to: 'DELEGATED',
      roles: PEOPLE,
    },
    // The system marks a delegated item done when its task is done.
    { from: EA_LIVE, action: 'done', to: 'DONE', roles: [...PEOPLE, 'system'] },
    { from: [...EA_LIVE, 'DONE'], action: 'close', to: 'CLOSED', roles: PEOPLE },
    { from: ['DONE', 'CLOSED'], action: 'reopen', to: 'CAPTURED', roles: PEOPLE },
    {
      from: 'SCHEDULED',
      action: 'missDay',
      to: 'SOMEDAY',
      roles: ['system'],
      guard: (c) => c.missedDayToSomeday,
    },
    { from: 'INFORMATION', action: 'expire', to: 'CLOSED', roles: ['system'] },
  ],
});
