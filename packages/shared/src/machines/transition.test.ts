import { describe, expect, it } from 'vitest';
import { availableActions, defineMachine, transition, TransitionError } from './transition';

type S = 'OPEN' | 'PENDING_VERIFY' | 'DONE' | 'CANCELLED';
type A = 'markDone' | 'verify' | 'cancel';
type R = 'doer' | 'verifier' | 'creator';
type C = { verifies: boolean };

const machine = defineMachine<S, A, R, C>({
  name: 'sample',
  states: ['OPEN', 'PENDING_VERIFY', 'DONE', 'CANCELLED'],
  terminal: ['CANCELLED'],
  rules: [
    {
      from: 'OPEN',
      action: 'markDone',
      to: (c) => (c.verifies ? 'PENDING_VERIFY' : 'DONE'),
      roles: ['doer'],
    },
    { from: 'PENDING_VERIFY', action: 'verify', to: 'DONE', roles: ['verifier'], guard: (c) => c.verifies },
    { from: '*', action: 'cancel', to: 'CANCELLED', roles: ['creator'] },
  ],
});

const run = (from: S, action: A, roles: R[], verifies = true) =>
  transition(machine, { from, action, roles, ctx: { verifies } });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof TransitionError ? e.code : 'OTHER';
  }
  return undefined;
}

describe('transition()', () => {
  it('moves to a computed target', () => {
    expect(run('OPEN', 'markDone', ['doer']).to).toBe('PENDING_VERIFY');
    expect(run('OPEN', 'markDone', ['doer'], false).to).toBe('DONE');
  });

  it('supports wildcard from', () => {
    expect(run('PENDING_VERIFY', 'cancel', ['creator']).to).toBe('CANCELLED');
  });

  it('rejects unknown transitions', () => {
    expect(codeOf(() => run('DONE', 'verify', ['verifier']))).toBe('INVALID_TRANSITION');
  });

  it('rejects the wrong role', () => {
    expect(codeOf(() => run('OPEN', 'markDone', ['verifier']))).toBe('FORBIDDEN_TRANSITION');
  });

  it('respects guards', () => {
    expect(codeOf(() => run('PENDING_VERIFY', 'verify', ['verifier'], false))).toBe('GUARD_FAILED');
  });

  it('never leaves a terminal state', () => {
    expect(codeOf(() => run('CANCELLED', 'cancel', ['creator']))).toBe('INVALID_TRANSITION');
  });

  it('lists available actions per role', () => {
    expect(availableActions(machine, 'OPEN', ['doer', 'creator'], { verifies: true })).toEqual([
      'markDone',
      'cancel',
    ]);
    expect(availableActions(machine, 'PENDING_VERIFY', ['verifier'], { verifies: false })).toEqual([]);
  });
});
