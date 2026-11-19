import { describe, expect, it } from 'vitest';
import * as banquet from './banquet';
import * as bill from './bill';
import * as checklist from './checklist';
import * as crm from './crm';
import * as delegation from './delegation';
import * as ea from './ea';
import * as hotel from './hotel';
import * as hr from './hr';
import * as ims from './ims';
import * as pos from './pos';
import * as reservation from './reservation';
import * as slip from './slip';
import * as stock from './stock';
import * as ticket from './ticket';
import * as records from '../records/machine';
import { transition, TransitionError, type Machine } from './transition';

type AnyMachine = Machine<string, string, string, unknown>;
const isMachine = (x: unknown): x is AnyMachine =>
  typeof x === 'object' && x !== null && 'rules' in x && 'states' in x && 'name' in x;
const MACHINES: AnyMachine[] = [
  banquet,
  bill,
  checklist,
  crm,
  delegation,
  ea,
  hotel,
  hr,
  ims,
  pos,
  reservation,
  slip,
  stock,
  ticket,
  records,
].flatMap((mod) => Object.values(mod).filter(isMachine));

/** A context that says yes (or no) to whatever a guard asks: settings on, or settings off. */
const answering = (value: boolean): unknown =>
  new Proxy({}, { get: (_t, key) => (key === Symbol.toPrimitive ? () => (value ? 1 : 0) : value) });
const CONTEXTS = [answering(true), answering(false)];
const fromList = (m: AnyMachine, from: AnyMachine['rules'][number]['from']) =>
  from === '*'
    ? m.states.filter((s) => !m.terminal?.includes(s))
    : typeof from === 'string'
      ? [from]
      : [...from];
const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof TransitionError ? e.code : `THROWN ${(e as Error).message}`;
  }
};

describe('every state machine, every move', () => {
  it('finds all of them', () => {
    expect(MACHINES.length).toBeGreaterThanOrEqual(28);
    expect(new Set(MACHINES.map((m) => m.name)).size).toBe(MACHINES.length);
  });

  for (const m of MACHINES) {
    describe(m.name, () => {
      const actions = [...new Set(m.rules.map((r) => r.action))];
      const roles = [...new Set(m.rules.flatMap((r) => r.roles))];

      it('is well formed: every state named exists, and every state can be reached and left (or is final)', () => {
        const states = new Set(m.states);
        for (const t of m.terminal ?? []) expect(states.has(t), `final state ${t}`).toBe(true);
        const reached = new Set<string>([m.states[0]!]);
        const left = new Set<string>();
        for (const r of m.rules) {
          for (const f of fromList(m, r.from)) {
            expect(states.has(f), `rule ${r.action} from ${f}`).toBe(true);
            left.add(f);
          }
          const targets =
            typeof r.to === 'function' ? CONTEXTS.map((c) => (r.to as (c: unknown) => string)(c)) : [r.to];
          for (const to of targets) {
            expect(states.has(to), `rule ${r.action} to ${to}`).toBe(true);
            reached.add(to);
          }
        }
        // (Where the target is worked out from amounts — a bill part paid or paid — yes / no answers cannot
        // show every target; those machines have their own tests.)
        const computed = m.rules.some((r) => typeof r.to === 'function');
        for (const s of m.states) {
          if (!m.terminal?.includes(s))
            expect(left.has(s), `${s} has no way out and is not final`).toBe(true);
          if (!computed) expect(reached.has(s), `${s} can never be reached`).toBe(true);
        }
      });

      it('allows every move in its table, for each role named, to a state it knows', () => {
        for (const r of m.rules)
          for (const from of fromList(m, r.from))
            for (const role of r.roles) {
              // A rule that starts in a final state can never happen: the table contradicts itself.
              expect(m.terminal?.includes(from) ?? false, `${r.action} from the final state ${from}`).toBe(
                false,
              );
              // With the settings a guard asks about switched on, or off — one of the two lets the move through
              // (another rule for the same move may take over; the answer must still be a known state).
              const results = CONTEXTS.map((ctx) => {
                try {
                  return transition(m, { from, action: r.action, roles: [role], ctx }).to;
                } catch (e) {
                  return e instanceof TransitionError && e.code === 'GUARD_FAILED'
                    ? null
                    : `ERROR ${String(e)}`;
                }
              });
              const went = results.filter((x): x is string => x !== null);
              expect(went.length, `${from} --${r.action}(${role})`).toBeGreaterThan(0);
              for (const to of went)
                expect(m.states, `${from} --${r.action}(${role})--> ${to}`).toContain(to);
            }
      });

      it('refuses every move that is not in its table, and every move out of a final state', () => {
        for (const from of m.states)
          for (const action of actions) {
            const exists = m.rules.some((r) => r.action === action && fromList(m, r.from).includes(from));
            if (exists && !m.terminal?.includes(from)) continue;
            expect(
              codeOf(() => transition(m, { from, action, roles, ctx: CONTEXTS[0] })),
              `${from} --${action}`,
            ).toBe('INVALID_TRANSITION');
          }
        expect(
          codeOf(() =>
            transition(m, { from: m.states[0]!, action: 'no-such-action', roles, ctx: CONTEXTS[0] }),
          ),
        ).toBe('INVALID_TRANSITION');
      });

      it('refuses a role the move is not open to, and nobody at all', () => {
        for (const r of m.rules)
          for (const from of fromList(m, r.from)) {
            if (m.terminal?.includes(from)) continue;
            const open = new Set(
              m.rules
                .filter((x) => x.action === r.action && fromList(m, x.from).includes(from))
                .flatMap((x) => x.roles),
            );
            expect(
              codeOf(() => transition(m, { from, action: r.action, roles: [], ctx: CONTEXTS[0] })),
              `${from} --${r.action} by nobody`,
            ).toBe('FORBIDDEN_TRANSITION');
            for (const role of roles.filter((x) => !open.has(x)))
              expect(
                codeOf(() => transition(m, { from, action: r.action, roles: [role], ctx: CONTEXTS[0] })),
                `${from} --${r.action} by ${role}`,
              ).toBe('FORBIDDEN_TRANSITION');
          }
      });
    });
  }
});
