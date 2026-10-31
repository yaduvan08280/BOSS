/**
 * Generic state-machine helper. Every module defines its machine as a transition table
 * in this folder; API services call `transition()` and never set `status` directly.
 */
export type TransitionRule<S extends string, A extends string, R extends string, C> = {
  from: S | readonly S[] | '*';
  action: A;
  /** Target status, or a function that picks it from the context (e.g. skip verification). */
  to: S | ((ctx: C) => S);
  /** Runtime guard, typically driven by per-company module settings. */
  guard?: (ctx: C) => boolean;
  roles: readonly R[];
};

export type Machine<S extends string, A extends string, R extends string, C> = {
  name: string;
  states: readonly S[];
  terminal?: readonly S[];
  rules: readonly TransitionRule<S, A, R, C>[];
};

export type TransitionErrorCode = 'INVALID_TRANSITION' | 'FORBIDDEN_TRANSITION' | 'GUARD_FAILED';

export class TransitionError extends Error {
  constructor(
    public readonly code: TransitionErrorCode,
    message: string,
    public readonly details: { machine: string; from: string; action: string },
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}

export function defineMachine<
  S extends string,
  A extends string,
  R extends string,
  C = Record<string, never>,
>(machine: Machine<S, A, R, C>): Machine<S, A, R, C> {
  return machine;
}

function matchesFrom<S extends string>(from: S | readonly S[] | '*', current: S): boolean {
  if (from === '*') return true;
  if (typeof from === 'string') return from === current;
  return from.includes(current);
}

export type TransitionInput<S extends string, A extends string, R extends string, C> = {
  from: S;
  action: A;
  roles: readonly R[];
  ctx: C;
};

export type TransitionResult<S extends string, A extends string> = { from: S; action: A; to: S };

/** Resolve the next status or throw a `TransitionError` explaining why it is not allowed. */
export function transition<S extends string, A extends string, R extends string, C>(
  machine: Machine<S, A, R, C>,
  input: TransitionInput<S, A, R, C>,
): TransitionResult<S, A> {
  const details = { machine: machine.name, from: input.from, action: input.action };
  if (machine.terminal?.includes(input.from)) {
    throw new TransitionError('INVALID_TRANSITION', `${machine.name}: ${input.from} is final`, details);
  }
  const candidates = machine.rules.filter(
    (r) => r.action === input.action && matchesFrom(r.from, input.from),
  );
  if (candidates.length === 0) {
    throw new TransitionError(
      'INVALID_TRANSITION',
      `${machine.name}: cannot ${input.action} from ${input.from}`,
      details,
    );
  }
  const permitted = candidates.filter((r) => r.roles.some((role) => input.roles.includes(role)));
  if (permitted.length === 0) {
    throw new TransitionError(
      'FORBIDDEN_TRANSITION',
      `${machine.name}: your role cannot ${input.action}`,
      details,
    );
  }
  const rule = permitted.find((r) => !r.guard || r.guard(input.ctx));
  if (!rule) {
    throw new TransitionError('GUARD_FAILED', `${machine.name}: ${input.action} is switched off`, details);
  }
  const to = typeof rule.to === 'function' ? rule.to(input.ctx) : rule.to;
  return { from: input.from, action: input.action, to };
}

/** Actions the given roles may take from a status right now (for showing buttons). */
export function availableActions<S extends string, A extends string, R extends string, C>(
  machine: Machine<S, A, R, C>,
  from: S,
  roles: readonly R[],
  ctx: C,
): A[] {
  if (machine.terminal?.includes(from)) return [];
  const actions = machine.rules
    .filter((r) => matchesFrom(r.from, from))
    .filter((r) => r.roles.some((role) => roles.includes(role)))
    .filter((r) => !r.guard || r.guard(ctx))
    .map((r) => r.action);
  return [...new Set(actions)];
}
