import { defineMachine } from './transition';

/** CLAUDE.md §5.1. REOPENED is recorded as an event; the task goes back to OPEN (decision 15). */
export const TASK_STATUSES = [
  'AWAITING_ACCEPTANCE',
  'OPEN',
  'PENDING_VERIFY',
  'DONE',
  'RETURNED_TO_CREATOR',
  'CANCELLED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_ACTIONS = [
  'accept',
  'decline',
  'moveDate',
  'addFollowUp',
  'markDone',
  'verify',
  'reject',
  'reopen',
  'reassign',
  'passOn',
  'addNote',
  'cancel',
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];
export type TaskRole = 'doer' | 'creator' | 'verifier' | 'admin' | 'any';

export type TaskContext = {
  doerMustAccept: boolean;
  allowReopen: boolean;
  /** True when someone has to verify (a verifier is set, or "EA verifies" is on). */
  needsVerify: boolean;
  /** Reassign / pass on: the new doer is the person who gave the task (they don't accept their own task). */
  toCreator?: boolean;
};

const handedTo = (c: TaskContext): TaskStatus =>
  c.doerMustAccept && !c.toCreator ? 'AWAITING_ACCEPTANCE' : 'OPEN';

const LIVE = ['AWAITING_ACCEPTANCE', 'OPEN', 'PENDING_VERIFY', 'RETURNED_TO_CREATOR'] as const;

export const delegationMachine = defineMachine<TaskStatus, TaskAction, TaskRole, TaskContext>({
  name: 'delegation',
  states: TASK_STATUSES,
  terminal: ['CANCELLED'],
  rules: [
    { from: 'AWAITING_ACCEPTANCE', action: 'accept', to: 'OPEN', roles: ['doer'] },
    { from: 'AWAITING_ACCEPTANCE', action: 'decline', to: 'RETURNED_TO_CREATOR', roles: ['doer'] },
    // Moving the date keeps the status (the service records the revision).
    {
      from: 'AWAITING_ACCEPTANCE',
      action: 'moveDate',
      to: 'AWAITING_ACCEPTANCE',
      roles: ['doer', 'creator', 'admin'],
    },
    { from: 'OPEN', action: 'moveDate', to: 'OPEN', roles: ['doer', 'creator', 'admin'] },
    // Follow-ups never change the status; the service keeps the current one.
    {
      from: ['AWAITING_ACCEPTANCE', 'OPEN', 'PENDING_VERIFY'],
      action: 'addFollowUp',
      to: 'OPEN',
      roles: ['any'],
    },
    {
      from: 'OPEN',
      action: 'markDone',
      to: (c) => (c.needsVerify ? 'PENDING_VERIFY' : 'DONE'),
      roles: ['doer'],
    },
    { from: 'PENDING_VERIFY', action: 'verify', to: 'DONE', roles: ['verifier', 'admin'] },
    {
      from: 'PENDING_VERIFY',
      action: 'reject',
      to: 'OPEN',
      roles: ['verifier', 'admin'],
      guard: (c) => c.allowReopen,
    },
    { from: 'DONE', action: 'reopen', to: 'OPEN', roles: ['creator', 'admin'], guard: (c) => c.allowReopen },
    {
      from: ['RETURNED_TO_CREATOR', 'AWAITING_ACCEPTANCE', 'OPEN'],
      action: 'reassign',
      to: handedTo,
      roles: ['creator', 'admin'],
    },
    // The doer did their part and hands the same task to the next person (who accepts it like a new task).
    { from: 'OPEN', action: 'passOn', to: handedTo, roles: ['doer'] },
    // Notes never change the status; anyone who can see the task may write one, also after it is done.
    { from: [...LIVE, 'DONE'], action: 'addNote', to: 'OPEN', roles: ['any'] },
    { from: [...LIVE, 'DONE'], action: 'cancel', to: 'CANCELLED', roles: ['creator', 'admin'] },
  ],
});

/** First status of a new task. Giving yourself a task skips acceptance. */
export function initialTaskStatus(
  ctx: { doerMustAccept: boolean },
  doerId: string,
  creatorId: string,
): TaskStatus {
  return ctx.doerMustAccept && doerId !== creatorId ? 'AWAITING_ACCEPTANCE' : 'OPEN';
}

/** Follow-ups, notes and date moves keep whatever status the task had (the machine only checks they're allowed). */
export const STATUS_KEEPING_ACTIONS: TaskAction[] = ['addFollowUp', 'addNote', 'moveDate'];
