import { defineMachine } from './transition';

/** CLAUDE.md §5.2: a run of a checklist master. */
export const RUN_STATUSES = ['OPEN', 'PENDING_VERIFY', 'DONE', 'MISSED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunAction = 'tick' | 'submit' | 'verify' | 'reject' | 'expire';
export type RunRole = 'doer' | 'verifier' | 'admin' | 'system';
export type RunContext = { verifierStep: boolean; hasVerifier: boolean; allItemsDone: boolean };

export const checklistMachine = defineMachine<RunStatus, RunAction, RunRole, RunContext>({
  name: 'checklist',
  states: RUN_STATUSES,
  terminal: ['DONE', 'MISSED'],
  rules: [
    { from: 'OPEN', action: 'tick', to: 'OPEN', roles: ['doer'] },
    {
      from: 'OPEN',
      action: 'submit',
      to: (c) => (c.verifierStep && c.hasVerifier ? 'PENDING_VERIFY' : 'DONE'),
      roles: ['doer'],
      guard: (c) => c.allItemsDone,
    },
    { from: 'OPEN', action: 'expire', to: 'MISSED', roles: ['system'] },
    { from: 'PENDING_VERIFY', action: 'verify', to: 'DONE', roles: ['verifier', 'admin'] },
    { from: 'PENDING_VERIFY', action: 'reject', to: 'OPEN', roles: ['verifier', 'admin'] },
  ],
});
