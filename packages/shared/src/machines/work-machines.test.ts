import { describe, expect, it } from 'vitest';
import { checklistMachine } from './checklist';
import { delegationMachine, initialTaskStatus, type TaskContext } from './delegation';
import { availableActions, transition, type TransitionError } from './transition';

const ctx: TaskContext = { doerMustAccept: true, allowReopen: true, needsVerify: true };
const t = (
  from: Parameters<typeof transition<string, string, string, TaskContext>>[1]['from'],
  action: string,
  roles: string[],
  c: Partial<TaskContext> = {},
) =>
  transition(delegationMachine, {
    from: from as never,
    action: action as never,
    roles: roles as never,
    ctx: { ...ctx, ...c },
  }).to;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as TransitionError).code;
  }
  return 'OK';
};

describe('delegation machine', () => {
  it('starts awaiting acceptance only when needed', () => {
    expect(initialTaskStatus({ doerMustAccept: true }, 'a', 'b')).toBe('AWAITING_ACCEPTANCE');
    expect(initialTaskStatus({ doerMustAccept: true }, 'a', 'a')).toBe('OPEN');
    expect(initialTaskStatus({ doerMustAccept: false }, 'a', 'b')).toBe('OPEN');
  });

  it('runs the full happy path', () => {
    expect(t('AWAITING_ACCEPTANCE', 'accept', ['doer'])).toBe('OPEN');
    expect(t('OPEN', 'markDone', ['doer'])).toBe('PENDING_VERIFY');
    expect(t('PENDING_VERIFY', 'verify', ['verifier'])).toBe('DONE');
  });

  it('skips verification when nobody verifies', () => {
    expect(t('OPEN', 'markDone', ['doer'], { needsVerify: false })).toBe('DONE');
  });

  it('declines back to the creator, who can reassign', () => {
    expect(t('AWAITING_ACCEPTANCE', 'decline', ['doer'])).toBe('RETURNED_TO_CREATOR');
    expect(t('RETURNED_TO_CREATOR', 'reassign', ['creator'])).toBe('AWAITING_ACCEPTANCE');
    expect(t('RETURNED_TO_CREATOR', 'reassign', ['creator'], { doerMustAccept: false })).toBe('OPEN');
  });

  it('rejects and reopens only when allowed', () => {
    expect(t('PENDING_VERIFY', 'reject', ['verifier'])).toBe('OPEN');
    expect(t('DONE', 'reopen', ['creator'])).toBe('OPEN');
    expect(code(() => t('PENDING_VERIFY', 'reject', ['verifier'], { allowReopen: false }))).toBe(
      'GUARD_FAILED',
    );
    expect(code(() => t('DONE', 'reopen', ['creator'], { allowReopen: false }))).toBe('GUARD_FAILED');
  });

  it('keeps people to their part', () => {
    expect(code(() => t('OPEN', 'markDone', ['creator']))).toBe('FORBIDDEN_TRANSITION');
    expect(code(() => t('AWAITING_ACCEPTANCE', 'accept', ['creator']))).toBe('FORBIDDEN_TRANSITION');
    expect(code(() => t('PENDING_VERIFY', 'verify', ['doer']))).toBe('FORBIDDEN_TRANSITION');
    expect(code(() => t('AWAITING_ACCEPTANCE', 'markDone', ['doer']))).toBe('INVALID_TRANSITION');
    expect(code(() => t('CANCELLED', 'cancel', ['admin']))).toBe('INVALID_TRANSITION');
  });

  it('lists the buttons each person sees', () => {
    expect(availableActions(delegationMachine, 'AWAITING_ACCEPTANCE', ['doer', 'any'], ctx)).toEqual([
      'accept',
      'decline',
      'moveDate',
      'addFollowUp',
      'addNote',
    ]);
    expect(availableActions(delegationMachine, 'OPEN', ['creator'], ctx)).toEqual([
      'moveDate',
      'reassign',
      'cancel',
    ]);
    expect(availableActions(delegationMachine, 'OPEN', ['any'], ctx)).toEqual(['addFollowUp', 'addNote']);
    expect(availableActions(delegationMachine, 'OPEN', ['doer', 'any'], ctx)).toContain('passOn');
  });

  it('passes a task on: the next person accepts it, unless it goes back to whoever gave it', () => {
    const pass = (x: Partial<typeof ctx> = {}) =>
      transition(delegationMachine, {
        from: 'OPEN',
        action: 'passOn',
        roles: ['doer'],
        ctx: { ...ctx, ...x },
      }).to;
    expect(pass()).toBe('AWAITING_ACCEPTANCE');
    expect(pass({ toCreator: true })).toBe('OPEN');
    expect(pass({ doerMustAccept: false })).toBe('OPEN');
    // Only the doer passes it on, and only while it is open.
    expect(() =>
      transition(delegationMachine, { from: 'OPEN', action: 'passOn', roles: ['creator', 'any'], ctx }),
    ).toThrow();
    expect(() =>
      transition(delegationMachine, { from: 'PENDING_VERIFY', action: 'passOn', roles: ['doer'], ctx }),
    ).toThrow();
  });

  it('takes notes from anyone on a live or done task, never on a cancelled one', () => {
    for (const from of ['AWAITING_ACCEPTANCE', 'OPEN', 'PENDING_VERIFY', 'DONE'] as const)
      expect(availableActions(delegationMachine, from, ['any'], ctx)).toContain('addNote');
    expect(availableActions(delegationMachine, 'CANCELLED', ['any', 'admin'], ctx)).not.toContain('addNote');
  });
});

describe('checklist machine', () => {
  const c = { verifierStep: true, hasVerifier: true, allItemsDone: true };
  const run = (
    from: 'OPEN' | 'PENDING_VERIFY' | 'DONE' | 'MISSED',
    action: 'tick' | 'submit' | 'verify' | 'reject' | 'expire',
    roles: ('doer' | 'verifier' | 'admin' | 'system')[],
    x = {},
  ) => transition(checklistMachine, { from, action, roles, ctx: { ...c, ...x } }).to;
  it('submits to the verifier, or straight to done', () => {
    expect(run('OPEN', 'submit', ['doer'])).toBe('PENDING_VERIFY');
    expect(run('OPEN', 'submit', ['doer'], { verifierStep: false })).toBe('DONE');
    expect(run('OPEN', 'submit', ['doer'], { hasVerifier: false })).toBe('DONE');
  });
  it('needs every item ticked before submitting', () => {
    expect(code(() => run('OPEN', 'submit', ['doer'], { allItemsDone: false }))).toBe('GUARD_FAILED');
  });
  it('expires to missed (system only) and never comes back', () => {
    expect(run('OPEN', 'expire', ['system'])).toBe('MISSED');
    expect(code(() => run('OPEN', 'expire', ['doer']))).toBe('FORBIDDEN_TRANSITION');
    expect(code(() => run('MISSED', 'submit', ['doer']))).toBe('INVALID_TRANSITION');
  });
  it('verifier can send it back', () => {
    expect(run('PENDING_VERIFY', 'reject', ['verifier'])).toBe('OPEN');
    expect(run('PENDING_VERIFY', 'verify', ['verifier'])).toBe('DONE');
  });
});
